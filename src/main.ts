import "./style.css";

const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

type Speaker = { key: string; id: number };
type VoiceBlock = { language: string; label: string; speakers: Speaker[] };

let catalog: VoiceBlock[] = [];
/** 当前播放器正在用的 blob URL（可能在 synthCache 里另有引用） */
let lastAudioUrl: string | null = null;

const SYNTH_CACHE_MAX = 24;
/** 相同语言+说话人+语速+文本 → blob URL，避免重复请求后端 */
const synthCache = new Map<string, string>();

function synthCacheKey(
  language: string,
  speakerKey: string,
  speed: number,
  text: string,
): string {
  return `${language}\x00${speakerKey}\x00${speed}\x00${text}`;
}

/** 写入缓存并控制容量；会 revoke 被挤出的旧 URL */
function cacheStore(key: string, url: string): void {
  if (synthCache.has(key)) {
    const prev = synthCache.get(key)!;
    if (prev !== url) URL.revokeObjectURL(prev);
  }
  synthCache.set(key, url);
  while (synthCache.size > SYNTH_CACHE_MAX) {
    const oldest = synthCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const oldUrl = synthCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    synthCache.delete(oldest);
  }
}

function $(sel: string): HTMLElement {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as HTMLElement;
}

function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

const API_DOWN_HINT =
  "无法连接 API（默认代理到 127.0.0.1:37861，与 Melo API 一致）。请确认本机已用 pnpm dev 一并启动后端，或另开终端执行 pnpm run server。";

async function fetchVoices(): Promise<VoiceBlock[]> {
  let r: Response;
  try {
    r = await fetch(apiUrl("/api/voices"));
  } catch {
    throw new Error(API_DOWN_HINT);
  }
  if (!r.ok) throw new Error(`加载音色列表失败：${r.status}`);
  return (await r.json()) as VoiceBlock[];
}

function fillLanguageSelect(select: HTMLSelectElement): void {
  select.innerHTML = "";
  for (const block of catalog) {
    const opt = document.createElement("option");
    opt.value = block.language;
    opt.textContent = `${block.label} (${block.language})`;
    select.appendChild(opt);
  }
}

function fillSpeakerSelect(
  langSelect: HTMLSelectElement,
  spkSelect: HTMLSelectElement,
): void {
  const lang = langSelect.value;
  const block = catalog.find((b) => b.language === lang);
  spkSelect.innerHTML = "";
  if (!block) return;
  for (const s of block.speakers) {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.key;
    spkSelect.appendChild(opt);
  }
}

function updateSpeakerHint(langSelect: HTMLSelectElement): void {
  const el = document.getElementById("speaker-hint");
  if (!el) return;
  const lang = langSelect.value;
  const block = catalog.find((b) => b.language === lang);
  if (!block) {
    el.textContent = "";
    return;
  }
  const n = block.speakers.length;
  if (lang === "ZH" && n === 1) {
    el.textContent =
      "说明：官方中文 MeloTTS 权重里只带一个说话人（键名 ZH），不是界面漏选项。英语等语言才会拆成 EN-Default、EN-US 等多口音。";
  } else if (n <= 1) {
    el.textContent = `该语言 checkpoint 里目前只有 ${n} 种说话人，由上游模型配置决定。`;
  } else {
    el.textContent = `该语言共 ${n} 种说话人（如英语多为不同地区口音）。`;
  }
}

async function preloadLanguage(lang: string, statusEl: HTMLElement): Promise<void> {
  statusEl.textContent = `正在预加载模型 ${lang}（首次会下载权重，已缓存则很快）…`;
  statusEl.classList.remove("error");
  let r: Response;
  try {
    r = await fetch(apiUrl(`/api/preload?language=${encodeURIComponent(lang)}`), {
      method: "POST",
    });
  } catch {
    throw new Error(API_DOWN_HINT);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `预加载失败：${r.status}`);
  }
  statusEl.textContent = `模型 ${lang} 已就绪。`;
}

function mount(): void {
  const root = $("#app");
  root.innerHTML = `
    <h1>MeloTTS 本地合成</h1>
    <p class="sub">中文模型默认只有单一说话人（ZH）；英语等可多选口音。HF 权重已下载则不会重复拉取；相同参数在本页会缓存音频，避免重复请求后端。</p>
    <div class="card">
      <div class="row">
        <label for="lang">语言 / 模型</label>
        <select id="lang"></select>
      </div>
      <div class="row">
        <label for="speaker">说话人 / 音色</label>
        <select id="speaker"></select>
      </div>
      <p id="speaker-hint" class="speaker-hint" role="note"></p>
      <div class="row">
        <label for="text">文本</label>
        <textarea id="text" placeholder="中文模型支持中英混读…"></textarea>
      </div>
      <div class="row">
        <label for="speed">语速</label>
        <input id="speed" type="number" min="0.1" max="3" step="0.1" value="1" />
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="force-resynth" />
        <label for="force-resynth">强制重新合成（忽略本页缓存）</label>
      </div>
      <div class="actions">
        <button type="button" id="preload">预加载当前语言</button>
        <button type="button" id="synth">合成并播放</button>
      </div>
      <div id="status" class="status"></div>
      <audio id="player" controls></audio>
    </div>
    <p class="hint">开发：在本仓库根目录执行 <code>pnpm dev</code> 会先跑 <code>predev</code>（装 Node/Python 依赖与 UniDic），再起 API（<code>37861</code>）与 Vite（<code>47862</code>）。若只要前端、API 已在别处运行，可用 <code>pnpm run dev:web</code>。</p>
  `;

  const langSel = $("#lang") as HTMLSelectElement;
  const spkSel = $("#speaker") as HTMLSelectElement;
  const textEl = $("#text") as HTMLTextAreaElement;
  const speedEl = $("#speed") as HTMLInputElement;
  const forceEl = $("#force-resynth") as HTMLInputElement;
  const statusEl = $("#status");
  const player = $("#player") as HTMLAudioElement;
  const btnPreload = $("#preload") as HTMLButtonElement;
  const btnSynth = $("#synth") as HTMLButtonElement;

  const defaultText =
    "这是 MeloTTS 中文演示，在本机合成。\n\n支持中英混读，比如带一句 machine learning。\n\n想听英文口音时，把语言切换成 English，再点合成。";

  fetchVoices()
    .then((data) => {
      catalog = data;
      fillLanguageSelect(langSel);
      if (!textEl.value.trim()) textEl.value = defaultText;
      const zh = catalog.find((b) => b.language === "ZH");
      if (zh) langSel.value = "ZH";
      fillSpeakerSelect(langSel, spkSel);
      updateSpeakerHint(langSel);
    })
    .catch((e: unknown) => {
      statusEl.textContent = e instanceof Error ? e.message : String(e);
      statusEl.classList.add("error");
    });

  langSel.addEventListener("change", () => {
    fillSpeakerSelect(langSel, spkSel);
    updateSpeakerHint(langSel);
    statusEl.textContent = "";
    statusEl.classList.remove("error");
  });

  btnPreload.addEventListener("click", async () => {
    btnPreload.disabled = true;
    try {
      await preloadLanguage(langSel.value, statusEl);
    } catch (e: unknown) {
      statusEl.textContent = e instanceof Error ? e.message : String(e);
      statusEl.classList.add("error");
    } finally {
      btnPreload.disabled = false;
    }
  });

  btnSynth.addEventListener("click", async () => {
    btnSynth.disabled = true;
    statusEl.classList.remove("error");

    const text = textEl.value.trim();
    if (!text) {
      statusEl.textContent = "请输入要合成的文本。";
      statusEl.classList.add("error");
      btnSynth.disabled = false;
      return;
    }

    const speed = Number(speedEl.value) || 1;
    const cacheKey = synthCacheKey(langSel.value, spkSel.value, speed, text);

    if (!forceEl.checked && synthCache.has(cacheKey)) {
      lastAudioUrl = synthCache.get(cacheKey)!;
      player.src = lastAudioUrl;
      statusEl.textContent =
        "已播放本页缓存（未请求后端）。修改文本/语速/语言或勾选「强制重新合成」可重新推理。";
      try {
        await player.play();
      } catch {
        /* autoplay blocked */
      }
      btnSynth.disabled = false;
      return;
    }

    statusEl.textContent = "正在合成（首次该语言会下载权重）…";
    try {
      let r: Response;
      try {
        r = await fetch(apiUrl("/api/tts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: langSel.value,
            speaker_key: spkSel.value,
            text,
            speed,
          }),
        });
      } catch {
        throw new Error(API_DOWN_HINT);
      }
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || `合成失败：${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      cacheStore(cacheKey, url);
      lastAudioUrl = url;
      player.src = lastAudioUrl;
      statusEl.textContent = forceEl.checked ? "已强制重新合成。" : "完成（已记入本页缓存）。";
      try {
        await player.play();
      } catch {
        /* autoplay blocked */
      }
    } catch (e: unknown) {
      statusEl.textContent = e instanceof Error ? e.message : String(e);
      statusEl.classList.add("error");
    } finally {
      btnSynth.disabled = false;
    }
  });
}

mount();
