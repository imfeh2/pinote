import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SettingsSnapshot } from "@/stores/settings";

export async function listenSettingsUpdated(
  handler: (snapshot: SettingsSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<SettingsSnapshot>("settings-updated", (event) => {
    handler(event.payload);
  });
}
