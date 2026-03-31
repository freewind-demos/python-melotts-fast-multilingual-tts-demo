# MeloTTS 多语本地合成 Demo

## 简介

仓库根目录是 **Vite + TypeScript（vanilla-ts）** 的浏览器前端；**Python API** 全部在 **`server/src/`**。你在页面里选择语言与说话人，后端按需加载对应 MeloTTS 模型；权重由 Hugging Face 缓存在本机，**已下载的不会重复拉取**。

## 快速开始

### 环境要求

建议使用 **Python 3.10 或 3.11**。需要 **Node（pnpm）** 跑前端。首次合成需要联网以下载依赖与模型；之后可走本地缓存。

### 准备依赖（`predev`）

**`pnpm run dev` 会先自动执行 `pnpm run predev`**，无需单独敲两遍。

`predev` 会依次：**`pnpm install`**，并在 **`server/`** 创建/复用 `.venv` 后执行 **`bootstrap-env.sh --full`**（`pip install -U pip`、`pip install -r requirements.txt`、**`ensure_unidic.py`**）。若只想手动同步依赖而不起服务，可单独执行 **`pnpm run predev`**。若系统默认 `python3` 不合适，可先 `export MELO_PYTHON=/path/to/python3.11`。

### 后端（`server/`）

```bash
cd server
python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -U pip
pip install -r requirements.txt
```

**`predev` / `bootstrap-env.sh --full`** 会在装完 pip 依赖后运行 **`server/ensure_unidic.py`**（同上）。英文 G2P 若报错可执行：`cd server && .venv/bin/python -c "import nltk; nltk.download('averaged_perceptron_tagger_eng')"`。

启动 API（默认 `http://127.0.0.1:37861`，可用环境变量 `MELO_PORT` 修改）：

```bash
# 仓库根目录（与 pnpm dev 里调用的逻辑一致）
pnpm run server
```

或手动：

```bash
cd server
source .venv/bin/activate
python -m src
```

可选环境变量：`MELO_DEVICE`（`cpu` / `mps` / `cuda` / 默认自动）、`MELO_HOST`、`MELO_PORT`（改 API 端口时请同时 export，以便 `vite.config.ts` 里代理读到同一端口）。前端开发端口可用 `VITE_DEV_PORT` 覆盖（默认 `47862`）。

### 前端（仓库根目录）

```bash
pnpm install
```

同时起 **Melo API（默认 37861）+ Vite（默认 47862）**（推荐）。**每次 `pnpm dev` 会先跑 `predev`**（`pnpm install` + `bootstrap-env.sh --full`），再并行起 API 与前端。日常开发若已确定依赖无误、想跳过前置步骤，请用 **`pnpm run dev:web`** 且另开终端 **`pnpm run server`**，或自行分拆命令。

```bash
pnpm dev
```

只开前端（须**另行**在本机跑着 API，例如 `pnpm run server`）：

```bash
pnpm run dev:web
```

单独只起 API（优先使用 `server/.venv/bin/python`）：

```bash
pnpm run server
```

`pnpm dev` 使用 **`vite --host --open`**（默认监听 **`47862`**），并把浏览器的 `/api` **代理到本机 `127.0.0.1:37861`**（Melo API 默认端口）。`pnpm dev` 会先 **轮询 `/api/health`**，等 API 真正监听端口后再启动 Vite，避免首屏立刻请求 `/api` 时出现 `ECONNREFUSED`。首次安装 Python 依赖或加载模型时终端会打印 `[wait-api] 仍在等待…`，属正常情况。超时会提示检查（可用 `MELO_WAIT_API_MS` 调大等待毫秒数）。

若只要前端、API 已在跑，用 `pnpm run dev:web` 可跳过等待。

若单独部署静态前端，可 `pnpm build` 后由任意静态服务器托管，并设置 **`VITE_API_BASE`** 指向真实 API 地址（例如 `https://your-host`），未设置时请求为同源 `/api`。

### `pnpm build` 与预览

```bash
pnpm build
pnpm preview --host
```

## 概念讲解

### 第一部分：目录约定

根目录只放 **package.json、Vite 配置、前端 `src/`** 等前端资产；**`server/requirements.txt`、`server/src/app.py`** 承载 FastAPI 与 MeloTTS 调用，避免把 Python 与 Node 混在同一层 `src` 里。

### 第二部分：音色列表与懒加载

`GET /api/voices` 会读取各语言 checkpoint 附带的 **`spk2id`**（通过下载小型 `config.json`），前端用下拉框展示 **语言** 与 **说话人 key**。首次选择某一语言并合成时，`TTS(language=...)` 会拉取该语言的 `checkpoint.pth`；同一进程内模型实例会缓存，Hugging Face 磁盘缓存则跨次复用。

### 第三部分：预加载按钮

「预加载当前语言」会调用 `POST /api/preload?language=...`，只创建对应 `TTS` 实例并触发权重下载（若尚未缓存），适合在正式读稿前先等下载完成。

## 完整示例

克隆后在本机执行：

```bash
pnpm dev
```

（已包含 **`predev`**；仅同步依赖再起别的命令时可用 **`pnpm run predev`**。）

在页面中选「Chinese（ZH）」、说话人 `ZH`，输入中英混写句子，点击「合成并播放」。

## 注意事项

权重与缓存目录通常在用户目录下的 **`.cache/huggingface`**（或 `HF_HOME` 指定位置），体积较大。

若 macOS 上 `pip install` 需从源码编译 `numba` / `python-crfsuite` 失败，`server/requirements.txt` 已尽量固定带 wheel 的版本；仍失败时可尝试 `export SDKROOT="$(xcrun --show-sdk-path)"` 后再安装。

## 完整讲解（中文）

Piper 可以理解为「轻量 ONNX 路线」，MeloTTS 则是「多语 PyTorch 路线」：安装更重，但中文里夹英文往往更自然。本 Demo 通过 **浏览器选语言与说话人**，让后端只在需要时加载对应语言模型，并用 HF 缓存避免重复下载。若你愿意牺牲速度与显存换更强对话感，可再去看生成式对话 TTS 一类 Demo。
