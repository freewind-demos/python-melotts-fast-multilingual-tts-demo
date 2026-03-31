"""
MeloTTS FastAPI：按语言懒加载模型；权重由 Hugging Face 缓存，已下载则不会重复拉取。
"""

from __future__ import annotations

import asyncio
import io
import os
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any

import soundfile as sf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from melo.api import TTS
from melo.download_utils import LANG_TO_HF_REPO_ID, load_or_download_config
from pydantic import BaseModel, Field

from .tts_segment_norm import tts_to_numpy_segment_rms

# 首次请求 /api/voices 时会为每种语言下载 config.json（体积小，走 HF 缓存）
_LANG_LABELS: dict[str, str] = {
    "EN": "English",
    "EN_V2": "English (v2)",
    "EN_NEWEST": "English (newest)",
    "FR": "French",
    "ES": "Spanish",
    "JP": "Japanese",
    "ZH": "Chinese（支持中英混读）",
    "KR": "Korean",
}

_executor = ThreadPoolExecutor(max_workers=1)
_app_lock = asyncio.Lock()
_models: dict[str, TTS] = {}
_voice_catalog: list[dict[str, Any]] | None = None
_device: str = "auto"


def _resolve_device() -> str:
    raw = os.environ.get("MELO_DEVICE", "").strip()
    return raw if raw else "auto"


def _build_voice_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for lang in sorted(LANG_TO_HF_REPO_ID.keys()):
        hps = load_or_download_config(lang, use_hf=True)
        spk_raw = hps.data.spk2id
        pairs = getattr(spk_raw, "items", lambda: ())()
        speakers = [{"key": str(k), "id": int(v)} for k, v in pairs]
        out.append(
            {
                "language": lang,
                "label": _LANG_LABELS.get(lang, lang),
                "speakers": speakers,
            }
        )
    return out


def get_voice_catalog() -> list[dict[str, Any]]:
    global _voice_catalog
    if _voice_catalog is None:
        _voice_catalog = _build_voice_catalog()
    return _voice_catalog


def _ensure_speaker(language: str, speaker_key: str) -> int:
    for block in get_voice_catalog():
        if block["language"] != language:
            continue
        for sp in block["speakers"]:
            if sp["key"] == speaker_key:
                return int(sp["id"])
        break
    raise HTTPException(status_code=400, detail=f"Unknown speaker {speaker_key!r} for {language}")


async def _get_tts(language: str) -> TTS:
    if language not in LANG_TO_HF_REPO_ID:
        raise HTTPException(status_code=400, detail=f"Unsupported language {language!r}")
    async with _app_lock:
        if language in _models:
            return _models[language]
    loop = asyncio.get_running_loop()
    maker = partial(TTS, language=language, device=_device)
    tts = await loop.run_in_executor(_executor, maker)
    async with _app_lock:
        _models[language] = tts
    return tts


class SynthBody(BaseModel):
    language: str = Field(..., description="MeloTTS language code, e.g. ZH, EN")
    speaker_key: str = Field(..., description="Speaker key from /api/voices, e.g. ZH, EN-Default")
    text: str = Field(..., min_length=1, max_length=5000)
    speed: float = Field(1.0, gt=0.1, le=3.0)


def create_app() -> FastAPI:
    global _device
    _device = _resolve_device()

    app = FastAPI(title="MeloTTS Demo API", version="0.2.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.environ.get("MELO_CORS_ORIGINS", "*").split(","),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/voices")
    async def voices() -> JSONResponse:
        loop = asyncio.get_running_loop()
        catalog = await loop.run_in_executor(_executor, get_voice_catalog)
        return JSONResponse(content=catalog)

    @app.post("/api/preload")
    async def preload(language: str = Query(..., description="MeloTTS language code")) -> dict[str, str]:
        await _get_tts(language)
        return {"language": language, "status": "loaded"}

    @app.post("/api/tts")
    async def tts_endpoint(body: SynthBody) -> Response:
        speaker_id = _ensure_speaker(body.language, body.speaker_key)
        tts = await _get_tts(body.language)
        loop = asyncio.get_running_loop()

        def _synth() -> bytes:
            # 与上游相同：按句推理后拼接；各句先做 RMS 对齐，减轻句间音量起伏
            audio = tts_to_numpy_segment_rms(
                tts, body.text, speaker_id, speed=body.speed
            )
            buf = io.BytesIO()
            sf.write(buf, audio, tts.hps.data.sampling_rate, format="WAV", subtype="PCM_16")
            return buf.getvalue()

        data = await loop.run_in_executor(_executor, _synth)
        return Response(content=data, media_type="audio/wav")

    return app


app = create_app()
