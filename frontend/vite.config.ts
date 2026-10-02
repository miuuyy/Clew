import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          katex: ["katex"],
          markdown: ["react-markdown", "remark-gfm", "remark-math", "rehype-katex"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5178,
  },
});
