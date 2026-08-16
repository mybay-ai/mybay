import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  applyTheme,
  getStoredThemeMode,
  getSystemTheme,
  persistThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "../theme/theme";

export type { ResolvedTheme, ThemeMode } from "../theme/theme";

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getStoredThemeMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  const resolvedTheme = mode === "system" ? systemTheme : mode;

  useEffect(() => {
    applyTheme(mode, resolvedTheme);
  }, [mode, resolvedTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const lightMedia = window.matchMedia("(prefers-color-scheme: light)");
    const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(getSystemTheme());
    handleChange();
    lightMedia.addEventListener("change", handleChange);
    darkMedia.addEventListener("change", handleChange);
    return () => {
      lightMedia.removeEventListener("change", handleChange);
      darkMedia.removeEventListener("change", handleChange);
    };
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    persistThemeMode(nextMode);
  };

  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
