import { invoke } from "@tauri-apps/api/core";

export type WindowVisibility = "visible" | "hidden";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowPreferences {
  readOnly: boolean;
  opacity: number;
  scrollTop: number;
  visibility?: WindowVisibility;
}

export function saveWindowPreferences(
  preferences: WindowPreferences,
  options: {
    pushHiddenToTop?: boolean;
    preserveHiddenVisibility?: boolean;
  } = {},
) {
  return invoke<void>("save_note_preferences", { preferences, options });
}
