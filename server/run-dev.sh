#!/usr/bin/env sh
# 从仓库根目录执行: sh server/run-dev.sh
set -e
cd "$(dirname "$0")"

sh ./bootstrap-env.sh

exec .venv/bin/python -m src
