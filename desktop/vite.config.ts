import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The renderer is shell-agnostic: it is a plain web app that talks to the
// gateway over webchannel_v1 and reaches native capability only through
// `window.nullclaw` (see electron/preload.ts). It therefore also runs in a
// browser against a remote gateway, with the bridge absent.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: { port: 5273, strictPort: true },
});
