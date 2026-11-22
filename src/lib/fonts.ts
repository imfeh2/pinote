import { invoke } from "@tauri-apps/api/core";

export function listFontFamilies() {
  return invoke<string[]>("list_font_families");
}
