import { invoke } from "@tauri-apps/api/core";

export function getLegacyNoteCount() {
  return invoke<number>("get_legacy_note_count");
}

export function convertLegacyNotes() {
  return invoke<number>("convert_legacy_notes");
}

export function finishLegacyNotes() {
  return invoke<void>("finish_legacy_notes");
}
