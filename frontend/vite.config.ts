import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend's CORS allow-list is http://localhost:5173 and http://127.0.0.1:5173,
// so the dev server must stay on port 5173.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true},
  preview: { port: 5173, strictPort: true},
  build: { chunkSizeWarningLimit: 800 },
});
