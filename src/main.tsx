import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPWA } from "./pwa/register";
import { initImmersiveMode } from "./lib/tauri/immersive";

createRoot(document.getElementById("root")!).render(<App />);

registerPWA();
initImmersiveMode();
