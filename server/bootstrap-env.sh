#!/usr/bin/env sh
# 创建 server/.venv 并安装 Python 依赖。在 server 目录下执行。
#   sh ./bootstrap-env.sh           仅在缺少 uvicorn/fastapi 时 pip install（供 run-dev）
#   sh ./bootstrap-env.sh --full    总是 pip install -r requirements.txt（供 pnpm predev）
set -e
cd "$(dirname "$0")"

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
  esac
done

pick_python() {
  if [ -n "${MELO_PYTHON:-}" ] && command -v "$MELO_PYTHON" >/dev/null 2>&1; then
    printf '%s\n' "$MELO_PYTHON"
    return 0
  fi
  for cand in python3.11 python3.10 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
      printf '%s\n' "$cand"
      return 0
    fi
  done
  return 1
}

if [ ! -x .venv/bin/python ]; then
  PY="$(pick_python)" || {
    printf '%s\n' "未找到 python3。请安装 Python 3.10/3.11，或设置 MELO_PYTHON=/绝对路径/python（勿用 3.14：暂无 PyTorch wheel）。" >&2
    exit 1
  }
  printf '%s\n' "[bootstrap] 创建 server/.venv（解释器: $PY）…" >&2
  "$PY" -m venv .venv
fi

if [ "$FULL" = 1 ]; then
  printf '%s\n' "[bootstrap] pip install -r requirements.txt …" >&2
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements.txt
elif ! .venv/bin/python -c "import uvicorn, fastapi" 2>/dev/null; then
  printf '%s\n' "[bootstrap] 正在安装 server/requirements.txt …" >&2
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements.txt
fi

# MeloTTS import 链会初始化 MeCab/UniDic；dicdir 缺失会导致进程退出
if .venv/bin/python -c "import unidic" 2>/dev/null; then
  .venv/bin/python ./ensure_unidic.py || exit 1
fi
