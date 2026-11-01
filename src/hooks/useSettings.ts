import {
  createElement,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { DEFAULT_SETTINGS } from "@/stores/settings";
import {
  ensureSettingsStoreReady,
  getSettingsSnapshot,
  type SettingsPatch,
  subscribeSettingsStore,
  updateSettingsStore,
} from "@/stores/settingsStore";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { ready } = useSettings();

  useEffect(() => {
    void ensureSettingsStoreReady();
  }, []);

  if (!ready) return null;

  return createElement(Fragment, null, children);
}

export function useSettings() {
  const settings = useSyncExternalStore(
    subscribeSettingsStore,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );

  return {
    settings: settings ?? DEFAULT_SETTINGS,
    updateSettings: useCallback((patch: SettingsPatch) => {
      return updateSettingsStore(patch);
    }, []),
    ready: settings !== null,
  };
}
