"""
MeloTTS: multi-lingual VITS-family TTS, CPU/MPS/CUDA friendly.

Chinese speaker supports mixed Chinese and English (per upstream README).
"""

from __future__ import annotations

import argparse
import os
import sys


def pick_device() -> str:
    override = os.environ.get("MELO_DEVICE")
    if override:
        return override
    return "auto"


def main() -> int:
    parser = argparse.ArgumentParser(description="MeloTTS local demo")
    parser.add_argument(
        "--zh",
        default="我最近在学习 machine learning，顺便试试 Hello world。",
        help="Chinese (mixed EN) sample",
    )
    parser.add_argument(
        "--en",
        default="Did you ever hear a folk tale about a giant turtle?",
        help="English sample",
    )
    parser.add_argument("--out-zh", default="out-zh.wav")
    parser.add_argument("--out-en", default="out-en.wav")
    args = parser.parse_args()

    try:
        from melo.api import TTS
    except ImportError:
        print("Install deps: pip install -r requirements.txt", file=sys.stderr)
        return 1

    device = pick_device()

    # Chinese: language code ZH
    model_zh = TTS(language="ZH", device=device)
    spk_zh = model_zh.hps.data.spk2id
    model_zh.tts_to_file(args.zh, spk_zh["ZH"], args.out_zh, speed=1.0)

    # English: default accent
    model_en = TTS(language="EN", device=device)
    spk_en = model_en.hps.data.spk2id
    model_en.tts_to_file(args.en, spk_en["EN-Default"], args.out_en, speed=1.0)

    print(args.out_zh)
    print(args.out_en)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
