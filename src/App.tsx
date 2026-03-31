import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import type { VoiceBlock } from "./api";
import { fetchVoices, preloadLanguage, synthTts } from "./api";
import { countChars, DEFAULT_SAMPLE_TEXT, TTS_MAX_CHARS } from "./constants";
import { cacheGet, cacheHas, cacheStore, synthCacheKey } from "./synthCache";

function speakerHint(lang: string, block: VoiceBlock | undefined): string {
  if (!block) return "";
  const n = block.speakers.length;
  if (lang === "ZH" && n === 1) {
    return "说明：官方中文 MeloTTS 权重里只带一个说话人（键名 ZH），不是界面漏选项。英语等语言才会拆成 EN-Default、EN-US 等多口音。";
  }
  if (n <= 1) {
    return `该语言 checkpoint 里目前只有 ${n} 种说话人，由上游模型配置决定。`;
  }
  return `该语言共 ${n} 种说话人（如英语多为不同地区口音）。`;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [catalog, setCatalog] = useState<VoiceBlock[]>([]);
  const [language, setLanguage] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(1);
  const [forceResynth, setForceResynth] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [preloadBusy, setPreloadBusy] = useState(false);
  const [synthBusy, setSynthBusy] = useState(false);

  const currentBlock = useMemo(
    () => catalog.find((b) => b.language === language),
    [catalog, language],
  );

  const languageOptions = useMemo(
    () =>
      catalog.map((b) => ({
        value: b.language,
        label: `${b.label} (${b.language})`,
      })),
    [catalog],
  );

  const speakerOptions = useMemo(
    () =>
      (currentBlock?.speakers ?? []).map((s) => ({
        value: s.key,
        label: s.key,
      })),
    [currentBlock],
  );

  const charCount = countChars(text);
  const overLimit = charCount > TTS_MAX_CHARS;

  const setStatus = useCallback((msg: string, isError: boolean): void => {
    setStatusText(msg);
    setStatusError(isError);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchVoices()
      .then((data) => {
        if (cancelled) return;
        setStatus("", false);
        setCatalog(data);
        const zh = data.find((b) => b.language === "ZH");
        const lang = zh?.language ?? data[0]?.language ?? "";
        setLanguage(lang);
        const block = data.find((b) => b.language === lang);
        setSpeaker(block?.speakers[0]?.key ?? "");
        setText((t) => (t.trim() ? t : DEFAULT_SAMPLE_TEXT));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus(e instanceof Error ? e.message : String(e), true);
      });
    return () => {
      cancelled = true;
    };
  }, [setStatus]);

  const onLanguageChange = (lang: string): void => {
    setLanguage(lang);
    const block = catalog.find((b) => b.language === lang);
    setSpeaker(block?.speakers[0]?.key ?? "");
    setStatus("", false);
  };

  const onPreload = async (): Promise<void> => {
    setPreloadBusy(true);
    setStatus(`正在预加载模型 ${language}（首次会下载权重，已缓存则很快）…`, false);
    try {
      await preloadLanguage(language);
      setStatus(`模型 ${language} 已就绪。`, false);
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setPreloadBusy(false);
    }
  };

  const onSynth = async (): Promise<void> => {
    setSynthBusy(true);
    setStatusError(false);

    const trimmed = text.trim();
    if (!trimmed) {
      setStatus("请输入要合成的文本。", true);
      setSynthBusy(false);
      return;
    }
    if (countChars(trimmed) > TTS_MAX_CHARS) {
      setStatus(`单次最多 ${TTS_MAX_CHARS} 字（与后端一致），请删减后再合成。`, true);
      setSynthBusy(false);
      return;
    }

    const sp = speed || 1;
    const cacheKey = synthCacheKey(language, speaker, sp, trimmed);

    if (!forceResynth && cacheHas(cacheKey)) {
      const url = cacheGet(cacheKey)!;
      const player = audioRef.current;
      if (player) {
        player.src = url;
        setStatus(
          "已播放本页缓存（未请求后端）。修改文本/语速/语言或勾选「强制重新合成」可重新推理。",
          false,
        );
        try {
          await player.play();
        } catch {
          /* autoplay blocked */
        }
      }
      setSynthBusy(false);
      return;
    }

    setStatus("正在合成（首次该语言会下载权重）…", false);
    try {
      const blob = await synthTts({
        language,
        speaker_key: speaker,
        text: trimmed,
        speed: sp,
      });
      const url = URL.createObjectURL(blob);
      cacheStore(cacheKey, url);
      const player = audioRef.current;
      if (player) {
        player.src = url;
        setStatus(forceResynth ? "已强制重新合成。" : "完成（已记入本页缓存）。", false);
        try {
          await player.play();
        } catch {
          /* autoplay blocked */
        }
      }
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setSynthBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <Typography.Title level={1} style={{ marginBottom: 8 }}>
        MeloTTS 本地合成
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        中文模型默认只有单一说话人（ZH）；英语等可多选口音。HF 权重已下载则不会重复拉取；相同参数在本页会缓存音频，避免重复请求后端。
      </Typography.Paragraph>

      <Card>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <div style={{ marginBottom: 8 }}>语言 / 模型</div>
            <Select
              style={{ width: "100%" }}
              options={languageOptions}
              value={language || undefined}
              onChange={onLanguageChange}
              placeholder="加载音色列表中…"
              disabled={!catalog.length}
            />
          </div>

          <div>
            <div style={{ marginBottom: 8 }}>说话人 / 音色</div>
            <Select
              style={{ width: "100%" }}
              options={speakerOptions}
              value={speaker || undefined}
              onChange={setSpeaker}
              disabled={!currentBlock}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {speakerHint(language, currentBlock)}
            </Typography.Paragraph>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>文本</span>
              <Typography.Text type={overLimit ? "danger" : "secondary"}>
                {charCount} / {TTS_MAX_CHARS}
              </Typography.Text>
            </div>
            <Input.TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="中文模型支持中英混读。"
              rows={8}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              上面整段会<strong>一次提交</strong>到后端；MeloTTS 在服务器里仍<strong>按标点切成多段</strong>
              分别推理，再拼成一条音频，所以逗号、句号附近容易有「切段」式停顿，不是没传全。
            </Typography.Paragraph>
          </div>

          <div>
            <div style={{ marginBottom: 8 }}>语速</div>
            <InputNumber
              min={0.1}
              max={3}
              step={0.1}
              value={speed}
              onChange={(v) => setSpeed(typeof v === "number" ? v : 1)}
              style={{ width: "100%" }}
            />
          </div>

          <Checkbox checked={forceResynth} onChange={(e) => setForceResynth(e.target.checked)}>
            强制重新合成（忽略本页缓存）
          </Checkbox>

          <Space wrap>
            <Button onClick={onPreload} loading={preloadBusy} disabled={!language}>
              预加载当前语言
            </Button>
            <Button type="primary" onClick={onSynth} loading={synthBusy} disabled={!language}>
              合成并播放
            </Button>
          </Space>

          {statusText ? (
            <Typography.Text type={statusError ? "danger" : undefined}>{statusText}</Typography.Text>
          ) : null}

          <audio ref={audioRef} controls style={{ width: "100%" }} />
        </Space>
      </Card>

      <Typography.Paragraph type="secondary" style={{ marginTop: 24 }}>
        开发：在本仓库根目录执行 <Typography.Text code>pnpm dev</Typography.Text> 会先跑{" "}
        <Typography.Text code>predev</Typography.Text>
        （装 Node/Python 依赖与 UniDic），再起 API（<Typography.Text code>37861</Typography.Text>
        ）与 Vite（<Typography.Text code>47862</Typography.Text>
        ）。若只要前端、API 已在别处运行，可用 <Typography.Text code>pnpm run dev:web</Typography.Text>。
      </Typography.Paragraph>
    </div>
  );
}
