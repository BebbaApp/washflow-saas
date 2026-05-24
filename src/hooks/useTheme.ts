import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThemePreset {
  id: string;
  name: string;
  preview: { primary: string; bg: string; card: string };
  dark: Record<string, string>;
  light: Record<string, string>;
}

export const themePresets: ThemePreset[] = [
  {
    id: "aqua",
    name: "Aqua (Default)",
    preview: { primary: "#2bb8c4", bg: "#161b2e", card: "#1e2438" },
    dark: {
      "--background": "220 25% 10%",
      "--foreground": "210 20% 92%",
      "--card": "220 22% 14%",
      "--card-foreground": "210 20% 92%",
      "--popover": "220 22% 14%",
      "--popover-foreground": "210 20% 92%",
      "--primary": "185 72% 48%",
      "--primary-foreground": "220 25% 6%",
      "--secondary": "220 20% 20%",
      "--secondary-foreground": "210 20% 85%",
      "--muted": "220 18% 18%",
      "--muted-foreground": "215 15% 55%",
      "--accent": "185 72% 48%",
      "--accent-foreground": "220 25% 6%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "220 18% 22%",
      "--input": "220 18% 22%",
      "--ring": "185 72% 48%",
    },
    light: {
      "--background": "210 20% 96%",
      "--foreground": "220 25% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "220 25% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "220 25% 10%",
      "--primary": "185 72% 40%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "210 15% 90%",
      "--secondary-foreground": "220 20% 30%",
      "--muted": "210 15% 92%",
      "--muted-foreground": "215 15% 45%",
      "--accent": "185 72% 40%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "210 15% 85%",
      "--input": "210 15% 85%",
      "--ring": "185 72% 40%",
    },
  },
  {
    id: "ember",
    name: "Ember",
    preview: { primary: "#e85d3a", bg: "#1a1210", card: "#261c18" },
    dark: {
      "--background": "15 25% 8%",
      "--foreground": "30 20% 92%",
      "--card": "15 22% 12%",
      "--card-foreground": "30 20% 92%",
      "--popover": "15 22% 12%",
      "--popover-foreground": "30 20% 92%",
      "--primary": "14 78% 56%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "15 20% 18%",
      "--secondary-foreground": "30 20% 85%",
      "--muted": "15 18% 16%",
      "--muted-foreground": "15 15% 55%",
      "--accent": "14 78% 56%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "15 18% 20%",
      "--input": "15 18% 20%",
      "--ring": "14 78% 56%",
    },
    light: {
      "--background": "30 25% 96%",
      "--foreground": "15 25% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "15 25% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "15 25% 10%",
      "--primary": "14 78% 48%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "30 15% 90%",
      "--secondary-foreground": "15 20% 30%",
      "--muted": "30 15% 92%",
      "--muted-foreground": "15 15% 45%",
      "--accent": "14 78% 48%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "30 15% 85%",
      "--input": "30 15% 85%",
      "--ring": "14 78% 48%",
    },
  },
  {
    id: "violet",
    name: "Violet",
    preview: { primary: "#8b5cf6", bg: "#13101e", card: "#1c1730" },
    dark: {
      "--background": "260 30% 9%",
      "--foreground": "260 15% 92%",
      "--card": "260 28% 14%",
      "--card-foreground": "260 15% 92%",
      "--popover": "260 28% 14%",
      "--popover-foreground": "260 15% 92%",
      "--primary": "262 83% 66%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "260 22% 20%",
      "--secondary-foreground": "260 15% 85%",
      "--muted": "260 20% 17%",
      "--muted-foreground": "260 12% 55%",
      "--accent": "262 83% 66%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "260 20% 22%",
      "--input": "260 20% 22%",
      "--ring": "262 83% 66%",
    },
    light: {
      "--background": "260 20% 97%",
      "--foreground": "260 30% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "260 30% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "260 30% 10%",
      "--primary": "262 83% 55%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "260 15% 90%",
      "--secondary-foreground": "260 20% 30%",
      "--muted": "260 15% 92%",
      "--muted-foreground": "260 12% 45%",
      "--accent": "262 83% 55%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "260 15% 85%",
      "--input": "260 15% 85%",
      "--ring": "262 83% 55%",
    },
  },
  {
    id: "forest",
    name: "Forest",
    preview: { primary: "#22c55e", bg: "#0f1610", card: "#162018" },
    dark: {
      "--background": "135 20% 7%",
      "--foreground": "135 15% 92%",
      "--card": "140 22% 11%",
      "--card-foreground": "135 15% 92%",
      "--popover": "140 22% 11%",
      "--popover-foreground": "135 15% 92%",
      "--primary": "142 71% 45%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "140 18% 18%",
      "--secondary-foreground": "135 15% 85%",
      "--muted": "140 16% 15%",
      "--muted-foreground": "140 12% 50%",
      "--accent": "142 71% 45%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "140 16% 20%",
      "--input": "140 16% 20%",
      "--ring": "142 71% 45%",
    },
    light: {
      "--background": "135 20% 96%",
      "--foreground": "135 25% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "135 25% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "135 25% 10%",
      "--primary": "142 71% 38%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "135 15% 90%",
      "--secondary-foreground": "135 20% 30%",
      "--muted": "135 15% 92%",
      "--muted-foreground": "135 12% 45%",
      "--accent": "142 71% 38%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "135 15% 85%",
      "--input": "135 15% 85%",
      "--ring": "142 71% 38%",
    },
  },
  {
    id: "gold",
    name: "Gold",
    preview: { primary: "#eab308", bg: "#161410", card: "#21201a" },
    dark: {
      "--background": "40 20% 8%",
      "--foreground": "45 15% 92%",
      "--card": "42 18% 12%",
      "--card-foreground": "45 15% 92%",
      "--popover": "42 18% 12%",
      "--popover-foreground": "45 15% 92%",
      "--primary": "48 96% 48%",
      "--primary-foreground": "40 30% 8%",
      "--secondary": "40 16% 18%",
      "--secondary-foreground": "45 15% 85%",
      "--muted": "40 14% 16%",
      "--muted-foreground": "40 12% 50%",
      "--accent": "48 96% 48%",
      "--accent-foreground": "40 30% 8%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "40 14% 20%",
      "--input": "40 14% 20%",
      "--ring": "48 96% 48%",
    },
    light: {
      "--background": "45 25% 96%",
      "--foreground": "40 25% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "40 25% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "40 25% 10%",
      "--primary": "48 96% 40%",
      "--primary-foreground": "40 30% 8%",
      "--secondary": "45 15% 90%",
      "--secondary-foreground": "40 20% 30%",
      "--muted": "45 15% 92%",
      "--muted-foreground": "40 12% 45%",
      "--accent": "48 96% 40%",
      "--accent-foreground": "40 30% 8%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "45 15% 85%",
      "--input": "45 15% 85%",
      "--ring": "48 96% 40%",
    },
  },
  {
    id: "rose",
    name: "Rose",
    preview: { primary: "#f43f5e", bg: "#1a1015", card: "#261820" },
    dark: {
      "--background": "340 25% 8%",
      "--foreground": "340 15% 92%",
      "--card": "340 22% 12%",
      "--card-foreground": "340 15% 92%",
      "--popover": "340 22% 12%",
      "--popover-foreground": "340 15% 92%",
      "--primary": "350 89% 60%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "340 20% 18%",
      "--secondary-foreground": "340 15% 85%",
      "--muted": "340 18% 16%",
      "--muted-foreground": "340 12% 50%",
      "--accent": "350 89% 60%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "340 18% 20%",
      "--input": "340 18% 20%",
      "--ring": "350 89% 60%",
    },
    light: {
      "--background": "340 20% 97%",
      "--foreground": "340 25% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "340 25% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "340 25% 10%",
      "--primary": "350 89% 50%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "340 15% 90%",
      "--secondary-foreground": "340 20% 30%",
      "--muted": "340 15% 92%",
      "--muted-foreground": "340 12% 45%",
      "--accent": "350 89% 50%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "340 15% 85%",
      "--input": "340 15% 85%",
      "--ring": "350 89% 50%",
    },
  },
  {
    id: "slate",
    name: "Slate",
    preview: { primary: "#64748b", bg: "#0f1215", card: "#1a1e24" },
    dark: {
      "--background": "215 20% 7%",
      "--foreground": "210 15% 92%",
      "--card": "215 18% 12%",
      "--card-foreground": "210 15% 92%",
      "--popover": "215 18% 12%",
      "--popover-foreground": "210 15% 92%",
      "--primary": "215 16% 47%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "215 16% 18%",
      "--secondary-foreground": "210 15% 85%",
      "--muted": "215 14% 15%",
      "--muted-foreground": "215 12% 50%",
      "--accent": "215 16% 47%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 55%",
      "--destructive-foreground": "210 20% 98%",
      "--border": "215 14% 20%",
      "--input": "215 14% 20%",
      "--ring": "215 16% 47%",
    },
    light: {
      "--background": "210 20% 97%",
      "--foreground": "215 25% 10%",
      "--card": "0 0% 100%",
      "--card-foreground": "215 25% 10%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "215 25% 10%",
      "--primary": "215 16% 40%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "210 15% 90%",
      "--secondary-foreground": "215 20% 30%",
      "--muted": "210 15% 92%",
      "--muted-foreground": "215 12% 45%",
      "--accent": "215 16% 40%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 72% 50%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "210 15% 85%",
      "--input": "210 15% 85%",
      "--ring": "215 16% 40%",
    },
  },
];

type Mode = "dark" | "light";

const listeners = new Set<() => void>();
let currentThemeId: string =
  (typeof localStorage !== "undefined" && localStorage.getItem("aquawash-theme")) || "aqua";
let currentMode: Mode =
  ((typeof localStorage !== "undefined" && (localStorage.getItem("aquawash-mode") as Mode)) || "light");

function applyThemeGlobal(id: string, m: Mode) {
  const preset = themePresets.find((t) => t.id === id) || themePresets[0];
  const vars = m === "dark" ? preset.dark : preset.light;
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
  root.classList.toggle("dark", m === "dark");
}

if (typeof document !== "undefined") {
  applyThemeGlobal(currentThemeId, currentMode);
}

function notify() {
  listeners.forEach((l) => l());
}

export function useTheme() {
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const selectTheme = useCallback((id: string) => {
    currentThemeId = id;
    localStorage.setItem("aquawash-theme", id);
    applyThemeGlobal(currentThemeId, currentMode);
    notify();
  }, []);

  const toggleMode = useCallback(() => {
    currentMode = currentMode === "dark" ? "light" : "dark";
    localStorage.setItem("aquawash-mode", currentMode);
    applyThemeGlobal(currentThemeId, currentMode);
    notify();
  }, []);

  return {
    themeId: currentThemeId,
    mode: currentMode,
    selectTheme,
    toggleMode,
    presets: themePresets,
  };
}
