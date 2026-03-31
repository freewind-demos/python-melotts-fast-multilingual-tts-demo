import { defineConfig } from "vite";

/** 与 server 默认一致；改端口时请同步设置环境变量 MELO_PORT */
const meloPort = process.env.MELO_PORT ?? "37861";
/** 避免与常见 3000/5173/8080 等冲突；可用 VITE_DEV_PORT 覆盖 */
const devPort = Number.parseInt(process.env.VITE_DEV_PORT ?? "47862", 10);

export default defineConfig({
  server: {
    host: true,
    port: devPort,
    strictPort: false,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${meloPort}`,
        changeOrigin: true,
      },
    },
  },
});
