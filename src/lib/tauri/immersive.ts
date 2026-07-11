/**
 * Immersive / fullscreen helpers for the Tauri build.
 * No-ops in the browser preview.
 */
import { isTauri } from "./db";

const STORAGE_KEY = "washflow.immersive";

async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  const mod: any = await import(/* @vite-ignore */ "@tauri-apps/api/core");
  return mod.invoke(cmd, args) as Promise<T>;
}

export async function setImmersive(on: boolean): Promise<void> {
  await invoke("set_immersive", { on });
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {}
}

export async function toggleImmersive(): Promise<boolean> {
  const next = (await invoke<boolean>("toggle_immersive")) ?? false;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {}
  return next;
}

export async function isImmersive(): Promise<boolean> {
  return (await invoke<boolean>("is_immersive")) ?? false;
}

/**
 * Install app-wide keyboard shortcut (F11) + restore last preference.
 * Safe to call from web — becomes a no-op outside Tauri.
 */
export function initImmersiveMode(): () => void {
  if (!isTauri || typeof window === "undefined") return () => {};

  // Restore last state
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      void setImmersive(true);
    }
  } catch {}

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "F11") {
      e.preventDefault();
      void toggleImmersive();
    } else if (e.key === "Escape") {
      // Escape exits immersive so the user is never trapped
      void setImmersive(false);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
