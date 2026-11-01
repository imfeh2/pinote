import { setTheme } from "@tauri-apps/api/app";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSettings } from "@/hooks/useSettings";
import { logError, logInfo } from "@/lib/logger";

type ResolvedTheme = "light" | "dark";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribeSystemTheme(callback: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function useTheme() {
  const { settings, updateSettings } = useSettings();
  const pendingTheme = useRef<{ value: ResolvedTheme } | null>(null);
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemTheme,
  );
  const resolvedTheme: ResolvedTheme =
    settings.theme === "system" ? systemTheme : settings.theme;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    setTheme(settings.theme === "system" ? null : resolvedTheme).catch(
      (error) => {
        logError("theme", "set_native_theme_failed", error);
      },
    );
  }, [resolvedTheme, settings.theme]);

  const toggleTheme = useCallback(() => {
    const current = pendingTheme.current?.value ?? resolvedTheme;
    const request: { value: ResolvedTheme } = {
      value: current === "dark" ? "light" : "dark",
    };
    pendingTheme.current = request;
    void updateSettings({ theme: request.value })
      .then(() => logInfo("theme", "toggle_theme", { next: request.value }))
      .catch((error) => logError("theme", "save_theme_failed", error))
      .finally(() => {
        if (pendingTheme.current === request) pendingTheme.current = null;
      });
  }, [resolvedTheme, updateSettings]);

  return { theme: resolvedTheme, toggleTheme };
}
