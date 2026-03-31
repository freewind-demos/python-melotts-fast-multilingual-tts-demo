# MeloTTS 多语本地合成 Demo

## 简介

这个 Demo 用 **MeloTTS** 在本机生成中英文 `.wav`。相比 Piper，它用 **PyTorch 模型**，音质与混读通常更好一步；官方称 **CPU 可达到实时附近**，Apple Silicon 可把 `MELO_DEVICE` 设为 `mps` 试试能否加速（视版本而定）。

## 快速开始

### 环境要求

建议使用 **Python 3.10 或 3.11**（与上游测试版本接近）。需要 **网络** 用于首次安装依赖与下载权重（跑过一次后大多缓存到本机）。

### 安装

```bash
cd python-melotts-fast-multilingual-tts-demo
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

上游 `setup.py` 在安装后会执行 `python -m unidic download`（用于日语相关资源）。若你不需要日语且安装卡住，可到 MyShell `MeloTTS` 仓库 Issue 里查同类问题的解决办法，或改用上游推荐的 Docker 流程。

### 运行

```bash
source .venv/bin/activate
python src/main.py
```

会生成两个文件：`out-zh.wav`（中英混读示例）和 `out-en.wav`（英文示例）。

自定义文本与输出路径：

```bash
python src/main.py \
  --zh '这是 MeloTTS 中文，mixed with English.' \
  --en 'Plain English sentence.' \
  --out-zh /tmp/melo-zh.wav \
  --out-en /tmp/melo-en.wav
```

设备选择（可选）：

```bash
export MELO_DEVICE=cpu
python src/main.py

export MELO_DEVICE=mps
python src/main.py
```

## 概念讲解

### 第一部分：MeloTTS 的定位

MeloTTS 在一条命令里按 **语言代码**（如 `ZH`、`EN`）加载不同 checkpoint。中文路线支持 **中英混写**，适合技术文档、产品说明这类句子。它不是「最大」的生成式模型，但在 **速度 / 体积 / 听感** 之间折中得很好。

### 第二部分：`src/main.py` 的流程

脚本分别构造 `TTS(language='ZH')` 与 `TTS(language='EN')`，从 `model.hps.data.spk2id` 取说话人 id，再调用 `tts_to_file`。这与上游 `docs/install.md` 中的 Python API 一致，只是把句子与输出文件名暴露成命令行参数。

## 完整示例

最小可复现会话：

```bash
cd python-melotts-fast-multilingual-tts-demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python src/main.py
afplay out-zh.wav   # macOS 播放
```

## 注意事项

若 `pip install` 因 `unidic` 失败，优先查 MeloTTS 官方 issue；macOS 上也可用他们文档里的 **Docker** 方式起 `melo-ui` Web 界面。

权重体积比 Piper 大，第一次推理会下载到 Hugging Face 缓存目录（通常在用户目录下的 `.cache`）。

## 完整讲解（中文）

你可以把 Piper 理解为「轻量 ONNX 前端」，MeloTTS 则是「一套多语 PyTorch 模型」。安装成本更高，但 **中文里夹英文** 时往往更自然。本 Demo 故意 **拆成两个 wav**，让你对比同一环境下中文模型与英文模型的音色差别。下一步若你愿意牺牲速度与显存换更像真人的对话感，请打开 `python-chatts-generative-dialogue-tts-demo`。
