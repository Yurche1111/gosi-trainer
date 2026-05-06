import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// При деплое на github pages указываем base = "/<repo-name>/" через переменную окружения VITE_BASE.
// Для vercel/netlify/cloudflare-pages base = "/" (по умолчанию).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    base: env.VITE_BASE ?? "/",
    plugins: [react()],
  };
});
