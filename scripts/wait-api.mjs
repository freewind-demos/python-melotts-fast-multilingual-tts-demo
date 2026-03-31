/**
 * 轮询 Melo API，就绪后再退出（供 pnpm dev 里晚于 api 进程启动 Vite）。
 * 端口与 vite 代理一致：MELO_PORT，默认 37861。
 */
import { setTimeout as delay } from "node:timers/promises";

const port = process.env.MELO_PORT ?? "37861";
const url = `http://127.0.0.1:${port}/api/health`;
const maxMs = Number(process.env.MELO_WAIT_API_MS ?? 900_000);
const pollMs = 400;
const logEveryMs = 8000;

const start = Date.now();
let lastLog = 0;

process.stderr.write(`[wait-api] 等待 ${url}（首次可能需在 server 装依赖并加载 PyTorch，请稍候）…\n`);

while (Date.now() - start < maxMs) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (r.ok) {
      process.stderr.write(`[wait-api] API 已就绪。\n`);
      process.exit(0);
    }
  } catch {
    /* 连接被拒、超时等：继续轮询 */
  }
  const now = Date.now();
  if (now - lastLog >= logEveryMs) {
    lastLog = now;
    const sec = Math.round((now - start) / 1000);
    process.stderr.write(`[wait-api] 仍在等待…（已 ${sec}s）\n`);
  }
  await delay(pollMs);
}

process.stderr.write(`[wait-api] 超时（${maxMs}ms）未连上 ${url}，请检查 [api] 日志。\n`);
process.exit(1);
