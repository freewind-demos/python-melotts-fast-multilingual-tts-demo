const SYNTH_CACHE_MAX = 24;
const synthCache = new Map<string, string>();

export function synthCacheKey(
  language: string,
  speakerKey: string,
  speed: number,
  text: string,
): string {
  return `${language}\x00${speakerKey}\x00${speed}\x00${text}`;
}

export function cacheGet(key: string): string | undefined {
  return synthCache.get(key);
}

/** 写入缓存并控制容量；会 revoke 被挤出的旧 URL */
export function cacheStore(key: string, url: string): void {
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

export function cacheHas(key: string): boolean {
  return synthCache.has(key);
}
