#!/usr/bin/env sh
# 安装前端（pnpm）与后端（server/.venv + requirements.txt + UniDic）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

printf '%s\n' "[predev] pnpm install …"
pnpm install

printf '%s\n' "[predev] server/.venv + Python 依赖 …"
cd "$ROOT/server"
sh ./bootstrap-env.sh --full

printf '%s\n' "[predev] 完成。"
