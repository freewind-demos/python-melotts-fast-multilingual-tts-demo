#!/usr/bin/env python3
"""
确保 UniDic 词典在 site-packages/unidic/dicdir 下可用（MeloTTS import 会初始化 MeCab）。
无需手动执行 python -m unidic download；若 dicts.json 拉取失败则回落到固定 S3 地址。
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen, urlretrieve


def _unidic_pkg_dir() -> Path:
    import unidic  # noqa: PLC0415 — 需在 venv 内安装 unidic 后调用

    return Path(unidic.__file__).resolve().parent


def _dicdir_ok(dicdir: Path) -> bool:
    mecabrc = dicdir / "mecabrc"
    has_dic = (dicdir / "sys.dic").is_file() or (dicdir / "char.bin").is_file()
    return mecabrc.is_file() and has_dic


def _try_cli_download() -> bool:
    r = subprocess.run(
        [sys.executable, "-m", "unidic", "download"],
        capture_output=True,
        text=True,
        timeout=3600,
    )
    if r.returncode != 0 and r.stderr:
        print(r.stderr, file=sys.stderr, end="")
    return r.returncode == 0


def _dicts_latest() -> tuple[str, str]:
    url = "https://raw.githubusercontent.com/polm/unidic-py/master/dicts.json"
    with urlopen(url, timeout=120) as resp:
        data = json.loads(resp.read().decode())
    latest = data["latest"]
    return str(latest["version"]), str(latest["url"])


def _fetch_dicdir_fallback(cdir: Path, version: str, zip_url: str) -> None:
    dicdir = cdir / "dicdir"
    if dicdir.is_dir():
        shutil.rmtree(dicdir)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "unidic.zip"
        print(f"[ensure_unidic] 下载 {zip_url} …", file=sys.stderr)
        urlretrieve(zip_url, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_path)

        found = next(tmp_path.rglob("sys.dic"), None)
        if found is None:
            found = next(tmp_path.rglob("char.bin"), None)
        if found is None:
            raise RuntimeError("UniDic zip 中未找到 sys.dic / char.bin")

        src = found.parent.resolve()
        shutil.move(str(src), str(dicdir))

    (dicdir / "mecabrc").write_text("# MeloTTS demo (dummy mecabrc, see unidic-py)\n", encoding="utf-8")
    (dicdir / "version").write_text(f"unidic-{version}\n", encoding="utf-8")


def main() -> int:
    try:
        cdir = _unidic_pkg_dir()
    except ImportError:
        print("[ensure_unidic] 跳过：尚未安装 unidic。", file=sys.stderr)
        return 0

    dicdir = cdir / "dicdir"
    if _dicdir_ok(dicdir):
        return 0

    print("[ensure_unidic] dicdir 不完整，尝试 python -m unidic download …", file=sys.stderr)
    if _try_cli_download() and _dicdir_ok(dicdir):
        print("[ensure_unidic] unidic download 成功。", file=sys.stderr)
        return 0

    print("[ensure_unidic] CLI 失败，尝试从 dicts.json / S3 安装 …", file=sys.stderr)
    try:
        version, zip_url = _dicts_latest()
    except Exception as e:  # noqa: BLE001 — 网络 / JSON 失败时改用固定镜像
        version = "3.1.0+2021-08-31"
        zip_url = "https://cotonoha-dic.s3-ap-northeast-1.amazonaws.com/unidic-3.1.0.zip"
        print(f"[ensure_unidic] dicts.json 不可用 ({e})，使用固定 URL。", file=sys.stderr)

    try:
        _fetch_dicdir_fallback(cdir, version, zip_url)
    except OSError as e:
        print(f"[ensure_unidic] 失败: {e}", file=sys.stderr)
        return 1

    if not _dicdir_ok(dicdir):
        print("[ensure_unidic] 解压后仍缺少 dicdir/mecabrc 或词典文件。", file=sys.stderr)
        return 1

    print("[ensure_unidic] 完成。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
