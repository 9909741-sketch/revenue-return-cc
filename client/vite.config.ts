import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Конфигурация сборщика клиента.
// В разработке фронтенд поднимается на своём порту и проксирует запросы
// /api на сервер Express (порт задаётся переменной SERVER_PORT, по умолчанию 3001).
// В продакшене клиент собирается в client/dist, а Express сам отдаёт эти файлы.
export default defineConfig(({ mode }) => {
  const serverPort = process.env.SERVER_PORT || "3001";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: mode !== "production",
    },
  };
});
