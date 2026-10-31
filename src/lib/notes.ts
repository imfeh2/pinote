import { appDataDir, resolve } from "@tauri-apps/api/path";

const NOTE_FILE_EXTENSION = ".md";
const NOTE_DIRECTORY = "notes";

function randomHexByte(byte: number) {
  return byte.toString(16).padStart(2, "0");
}

export function buildGeneratedNoteId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, randomHexByte).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function sanitizeNoteId(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function normalizeNoteId(value?: string | null) {
  const sanitized = sanitizeNoteId(value);
  return sanitized.length > 0 ? sanitized : buildGeneratedNoteId();
}

export function getNoteIdFromPath(notePath: string) {
  const fileName = notePath.split(/[\\/]/).pop() ?? "";
  const withoutExt = fileName.toLowerCase().endsWith(NOTE_FILE_EXTENSION)
    ? fileName.slice(0, -NOTE_FILE_EXTENSION.length)
    : fileName;
  return normalizeNoteId(withoutExt);
}

export async function resolveDefaultNotesDirectory() {
  const root = await appDataDir();
  return resolve(root, NOTE_DIRECTORY);
}
