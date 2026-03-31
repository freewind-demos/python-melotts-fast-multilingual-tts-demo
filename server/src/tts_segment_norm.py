"""
与 MeloTTS 内置流程一致：按标点拆分（中文含逗号）、逐句推理，再拼接。

1) 各段 RMS 归一，减轻句与句之间的整体音量差。
2) 段间衔接：上一段尾部与本段头部短时 RMS 比对，对本段乘受限增益。
3) 段间静音：上游固定约 50ms，逗号与句号听感雷同；这里按段末标点区分停顿时长（逗号短、句末长）。
"""

from __future__ import annotations

import os
import re

import numpy as np
import torch
from melo import utils
from melo.api import TTS

# 与 melo.api.TTS.tts_to_file 默认一致
_SDP = 0.2
_NOISE = 0.6
_NOISE_W = 0.8


def _parse_target_rms() -> float:
    raw = os.environ.get("MELO_TTS_SEGMENT_RMS", "0.065").strip()
    try:
        v = float(raw)
        return max(1e-4, min(v, 0.3))
    except ValueError:
        return 0.065


def _rms_normalize_segment(
    wav: np.ndarray,
    target_rms: float,
    *,
    max_peak: float = 0.99,
) -> np.ndarray:
    x = np.asarray(wav, dtype=np.float32).reshape(-1)
    rms = float(np.sqrt(np.mean(x * x)))
    if rms < 1e-8:
        return x
    x = x * (target_rms / rms)
    peak = float(np.max(np.abs(x)))
    if peak > max_peak:
        x = x * (max_peak / peak)
    return x


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        v = float(raw)
        return max(lo, min(v, hi))
    except ValueError:
        return default


def _bridge_segments(
    segments: list[np.ndarray],
    sr: int,
    *,
    max_peak: float = 0.99,
) -> list[np.ndarray]:
    """按相邻段尾部/头部短时窗 RMS 比例，微调后一段整体增益（带上下限）。"""
    if os.environ.get("MELO_TTS_BRIDGE", "1").strip().lower() in ("0", "false", "no", "off"):
        return [np.asarray(s, dtype=np.float32).copy() for s in segments]

    window_ms = _env_float("MELO_TTS_BRIDGE_MS", 35.0, 8.0, 80.0)
    gain_min = _env_float("MELO_TTS_BRIDGE_GAIN_MIN", 0.82, 0.5, 1.0)
    gain_max = _env_float("MELO_TTS_BRIDGE_GAIN_MAX", 1.38, 1.0, 2.0)

    if len(segments) <= 1:
        return [np.asarray(segments[0], dtype=np.float32).copy()]

    w = max(1, int(sr * window_ms / 1000.0))
    out: list[np.ndarray] = [np.asarray(segments[0], dtype=np.float32).copy()]

    for i in range(1, len(segments)):
        prev = out[i - 1]
        cur = np.asarray(segments[i], dtype=np.float32).copy()
        wt = min(w, max(len(prev), len(cur)) // 2)
        if wt < 64:
            out.append(cur)
            continue
        wt = min(wt, len(prev), len(cur))
        tail = prev[-wt:]
        head = cur[:wt]
        r_t = float(np.sqrt(np.mean(tail * tail)))
        r_h = float(np.sqrt(np.mean(head * head)))
        if r_h < 1e-8 or r_t < 1e-8:
            out.append(cur)
            continue
        g = r_t / r_h
        g = max(gain_min, min(gain_max, g))
        cur = cur * g
        pk = float(np.max(np.abs(cur)))
        if pk > max_peak:
            cur = cur * (max_peak / pk)
        out.append(cur)

    return out


def _tail_punct_char(s: str) -> str | None:
    t = s.rstrip()
    while t and t[-1] in ('"', "'", "」", "』", "＂", "）", ")", "]", "】"):
        t = t[:-1].rstrip()
    if not t:
        return None
    return t[-1]


def _pause_ms_between_segments(texts: list[str]) -> list[float]:
    """第 i 项为段 i 与段 i+1 之间的静音时长（毫秒），与 melo 一样稍后再除以语速。"""
    scale = _env_float("MELO_PAUSE_SCALE", 1.0, 0.4, 2.5)
    ms_comma = _env_float("MELO_PAUSE_MS_COMMA", 24.0, 8.0, 90.0)
    ms_semi = _env_float("MELO_PAUSE_MS_SEMICOLON", 68.0, 25.0, 160.0)
    ms_sent = _env_float("MELO_PAUSE_MS_SENTENCE", 115.0, 55.0, 280.0)
    ms_def = _env_float("MELO_PAUSE_MS_DEFAULT", 50.0, 18.0, 140.0)

    out: list[float] = []
    for i in range(len(texts) - 1):
        ch = _tail_punct_char(texts[i])
        if ch is None:
            ms = ms_def
        elif ch in "。！？":
            ms = ms_sent
        elif ch in "，,":
            ms = ms_comma
        elif ch in "；;":
            ms = ms_semi
        elif ch in "：:":
            ms = (ms_comma + ms_semi) / 2.0
        elif ch == ".":
            ms = ms_sent
        elif ch in "!?":
            ms = ms_sent
        elif ch == "…":
            ms = ms_sent
        else:
            ms = ms_def
        out.append(ms * scale)
    return out


def _concat_with_pauses(
    segments: list[np.ndarray],
    pause_ms: list[float],
    sr: int,
    speed: float,
) -> np.ndarray:
    assert len(pause_ms) == max(0, len(segments) - 1)
    parts: list[np.ndarray] = []
    sp = max(speed, 0.1)
    for i, seg in enumerate(segments):
        parts.append(np.asarray(seg, dtype=np.float32).reshape(-1))
        if i < len(pause_ms):
            sec = (pause_ms[i] / 1000.0) / sp
            n = max(0, int(sr * sec))
            if n > 0:
                parts.append(np.zeros(n, dtype=np.float32))
    if not parts:
        return np.array([], dtype=np.float32)
    return np.concatenate(parts)


def tts_to_numpy_segment_rms(tts: TTS, text: str, speaker_id: int, speed: float = 1.0) -> np.ndarray:
    language = tts.language
    texts = tts.split_sentences_into_pieces(text, language, quiet=True)
    target_rms = _parse_target_rms()
    audio_list: list[np.ndarray] = []
    device = tts.device

    for t in texts:
        if language in ("EN", "ZH_MIX_EN"):
            t = re.sub(r"([a-z])([A-Z])", r"\1 \2", t)
        bert, ja_bert, phones, tones, lang_ids = utils.get_text_for_tts_infer(
            t, language, tts.hps, device, tts.symbol_to_id
        )
        with torch.no_grad():
            x_tst = phones.to(device).unsqueeze(0)
            tones_t = tones.to(device).unsqueeze(0)
            lang_ids_t = lang_ids.to(device).unsqueeze(0)
            bert_t = bert.to(device).unsqueeze(0)
            ja_bert_t = ja_bert.to(device).unsqueeze(0)
            x_tst_lengths = torch.LongTensor([phones.size(0)]).to(device)
            speakers = torch.LongTensor([speaker_id]).to(device)
            audio = tts.model.infer(
                x_tst,
                x_tst_lengths,
                speakers,
                tones_t,
                lang_ids_t,
                bert_t,
                ja_bert_t,
                sdp_ratio=_SDP,
                noise_scale=_NOISE,
                noise_scale_w=_NOISE_W,
                length_scale=1.0 / speed,
            )[0][0, 0].data.cpu().float().numpy()
        audio_list.append(_rms_normalize_segment(audio, target_rms))

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    sr = int(tts.hps.data.sampling_rate)
    audio_list = _bridge_segments(audio_list, sr)
    if os.environ.get("MELO_PAUSE_SMART", "1").strip().lower() in ("0", "false", "no", "off"):
        return TTS.audio_numpy_concat(audio_list, sr=sr, speed=speed)
    pauses = _pause_ms_between_segments(texts)
    return _concat_with_pauses(audio_list, pauses, sr, speed)
