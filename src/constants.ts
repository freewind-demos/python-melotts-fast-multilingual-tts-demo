/** 与 server/src/app.py SynthBody.max_length 一致 */
export const TTS_MAX_CHARS = 5000;

export const DEFAULT_SAMPLE_TEXT = `这是在本机跑的 MeloTTS 示例，数据不出这台机器。平时写材料中英文会自然夹着来：对一下 release timeline、看一眼 dashboard 上的 error rate，再随口补一句 “I’ll update the ticket later”.

句子里出现 PyTorch、CI pipeline 这类词很正常；你可以改两三个字再点合成，听听第二次是不是走缓存、几乎秒播。想换音色就把语言切成 English 再试。底下有字数统计，单次别超过五千字；逗号和句号后的停顿长短会略有不同。`;

export function countChars(s: string): number {
  return [...s].length;
}
