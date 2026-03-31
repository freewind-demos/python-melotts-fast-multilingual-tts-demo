const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export const API_DOWN_HINT =
  "无法连接 API（默认代理到 127.0.0.1:37861，与 Melo API 一致）。请确认本机已用 pnpm dev 一并启动后端，或另开终端执行 pnpm run server。";

export type Speaker = { key: string; id: number };
export type VoiceBlock = { language: string; label: string; speakers: Speaker[] };

export function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

export async function fetchVoices(): Promise<VoiceBlock[]> {
  let r: Response;
  try {
    r = await fetch(apiUrl("/api/voices"));
  } catch {
    throw new Error(API_DOWN_HINT);
  }
  if (!r.ok) throw new Error(`加载音色列表失败：${r.status}`);
  return (await r.json()) as VoiceBlock[];
}

export async function preloadLanguage(lang: string): Promise<void> {
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
}

export async function synthTts(payload: {
  language: string;
  speaker_key: string;
  text: string;
  speed: number;
}): Promise<Blob> {
  let r: Response;
  try {
    r = await fetch(apiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(API_DOWN_HINT);
  }
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(errText || `合成失败：${r.status}`);
  }
  return r.blob();
}
