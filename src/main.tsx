import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// --- Service worker registration guard ---------------------------------
// We register the PWA service worker ONLY in real production contexts.
// In the Lovable editor preview (iframes / preview hosts) the SW would
// serve a stale shell and break HMR, so we proactively unregister it.
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const host = typeof window !== "undefined" ? window.location.hostname : "";
const isPreviewHost =
  host.includes("id-preview--") ||
  host.includes("preview--") ||
  host.endsWith("lovableproject.com") ||
  host.endsWith("lovableproject-dev.com") ||
  host.endsWith("lovable.app") === false && host.includes("lovable.app");

if ("serviceWorker" in navigator) {
  if (isInIframe || isPreviewHost) {
    // Clean up any previously installed SW so editor preview is never stale.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  } else if (import.meta.env.PROD) {
    // Lazy-load the auto-generated SW registration helper.
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        registerSW({ immediate: true });
      })
      .catch(() => {
        /* SW not available — fine */
      });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
