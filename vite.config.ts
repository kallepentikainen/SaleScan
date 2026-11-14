import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:https` serves over HTTPS on the LAN so a phone can grant
// microphone access (getUserMedia only works in a secure context).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  server: {
    host: true,
    allowedHosts: true,
    proxy: { "/api": "http://localhost:8787" },
  },
}));
