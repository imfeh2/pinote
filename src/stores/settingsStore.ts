import { invoke } from "@tauri-apps/api/core";
import { logError, logInfo } from "@/lib/logger";
import { listenSettingsUpdated } from "@/lib/settingsEvents";
import type { Settings, SettingsSnapshot } from "@/stores/settings";

export type SettingsPatch = Partial<Omit<Settings, "shortcuts">> & {
  shortcuts?: Partial<Settings["shortcuts"]>;
};

type SettingsListener = () => void;

let snapshot: SettingsSnapshot | null = null;
let loadPromise: Promise<void> | null = null;
let updatePromise: Promise<void> = Promise.resolve();
const listeners = new Set<SettingsListener>();

function applySnapshot(next: SettingsSnapshot) {
  if (snapshot && next.revision <= snapshot.revision) return snapshot;
  snapshot = next;
  for (const listener of listeners) listener();
  return snapshot;
}

export function ensureSettingsStoreReady() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const unlisten = await listenSettingsUpdated(applySnapshot);
      try {
        await refreshSettingsStore();
      } catch (error) {
        unlisten();
        throw error;
      }
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

export function subscribeSettingsStore(listener: SettingsListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSettingsSnapshot() {
  return snapshot?.settings ?? null;
}

export async function refreshSettingsStore() {
  return applySnapshot(await invoke<SettingsSnapshot>("get_settings")).settings;
}

export function updateSettingsStore(patch: SettingsPatch) {
  const operation = updatePromise.then(async () => {
    await ensureSettingsStoreReady();
    try {
      applySnapshot(
        await invoke<SettingsSnapshot>("update_settings", { patch }),
      );
      logInfo("settings", "settings_updated", { patch });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "snapshot" in error &&
        error.snapshot
      ) {
        applySnapshot(error.snapshot as SettingsSnapshot);
      }
      logError("settings", "save_failed", error);
      throw error;
    }
  });
  // 失败返回给调用方，后续独立修改仍能进入队列。
  updatePromise = operation.catch(() => {});
  return operation;
}
