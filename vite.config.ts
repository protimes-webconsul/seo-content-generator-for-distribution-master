import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load environment variables from .env files
  const env = loadEnv(mode, process.cwd(), "");

  // Log for debugging (本番環境では出力しない)
  if (mode !== "production") {
    console.log("Vite config - Mode:", mode);
    console.log("Vite config - GEMINI_API_KEY loaded:", !!env.GEMINI_API_KEY);
    console.log(
      "Vite config - GEMINI_API_KEY value:",
      env.GEMINI_API_KEY ? "****" : "NOT FOUND"
    );
  }

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5176,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://localhost:3010",
          changeOrigin: true,
          secure: false,
          configure: function(proxy) {
            proxy.on('error', function(err, req, res) {
              console.error('[Vite Proxy Error]', err.message, req.url);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
              }
            });
          },
        },
      },
    },
    define: {
      // Make environment variables available as process.env
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY || ""),
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY || ""),
      // VITE_プレフィックス付きの環境変数も定義
      "import.meta.env.VITE_GEMINI_API_KEY": JSON.stringify(
        env.GEMINI_API_KEY || ""
      ),
      "import.meta.env.VITE_INTERNAL_API_KEY": JSON.stringify(
        env.VITE_INTERNAL_API_KEY || ""
      ),
      "import.meta.env.VITE_API_URL": JSON.stringify(env.VITE_API_URL || ""),
      // Google Search APIキーはサーバー側でのみ使用（セキュリティのため）
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
