import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // CRITICAL: disable in dev so the SW never activates inside the Lovable
      // preview iframe (it would lock devices to a stale shell otherwise).
      devOptions: { enabled: false },
      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "AquaWash — Car Wash Management",
        short_name: "AquaWash",
        description:
          "Tablet-ready car wash management with offline order capture.",
        theme_color: "#0f1319",
        background_color: "#0f1319",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // OAuth callback and Supabase auth routes must never be cached.
        navigateFallbackDenylist: [/^\/~oauth/, /^\/auth\//],
        // Keep the precache lean — avoid caching giant chunks.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // HTML navigations: NetworkFirst so a new deploy is always picked
            // up; falls back to cached shell when offline.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "aquawash-html",
              networkTimeoutSeconds: 3,
            },
          },
          {
            // App JS/CSS/font chunks
            urlPattern: ({ request }) =>
              ["script", "style", "worker", "font"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "aquawash-assets" },
          },
          {
            // Images
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "aquawash-images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
