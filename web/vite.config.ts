import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  /**
   * Root by default, overridable for a subpath deploy.
   *
   * On its own domain the site sits at /. On GitHub Pages under a project repo it sits at
   * /market-lab/, and every asset and data URL has to agree — the data layer already
   * builds its paths from import.meta.env.BASE_URL for exactly this reason.
   */
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    /**
     * Pinned to a port of its own, not "whatever is free". Vite silently walks to the
     * next port when one is taken, and the backend's CORS allowlist was a fixed list of
     * ports — so an unrelated dev server on 5173 pushed this one to 5174 and every API
     * call was rejected, with the board still rendering because it falls back to static
     * data. Failing loudly on a busy port beats a half-working page.
     */
    port: 5180,
    strictPort: true,
    // Listen on all interfaces and accept proxied Host headers so preview panes,
    // tunnels and phones on the LAN can reach the dev server.
    host: true,
    allowedHosts: true,
    /**
     * Same-origin API in dev. Talking to http://localhost:8787 directly made every
     * request cross-origin for no reason, which is why the allowlist existed at all.
     * Proxying means dev and production use identical relative URLs.
     */
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
