import type { LanguagePreference } from "@/i18n/locale";
import defaults from "@/settings.defaults.json";

type Theme = "light" | "dark" | "system";
export type EditorFontFamily = "system" | "serif" | "mono";
export type WheelResizeModifier = "alt" | "ctrl" | "shift" | "meta";
export type WindowsGlassEffect = "none" | "mica" | "acrylic" | "blur";
export type DragMouseButton = "middle" | "right";

export interface Settings {
  language: LanguagePreference;
  theme: Theme;
  newNoteDirectory: string;
  noteGlassEffectWindows: WindowsGlassEffect;
  noteGlassEffectMacos: boolean;
  editorFontFamily: EditorFontFamily;
  editorFontSize: number;
  editorLineHeight: number;
  editorPaddingX: number;
  editorPaddingY: number;
  hideNoteWindowsFromTaskbar: boolean;
  contextMenuFollowNoteOpacity: boolean;
  confirmNoteDeletion: boolean;
  wheelResizeModifier: WheelResizeModifier;
  wheelOpacityModifier: WheelResizeModifier;
  dragMouseButton: DragMouseButton;
  lastUpdateCheckAt?: string;
  pendingUpdatePromptVersion?: string;
  dismissedUpdateVersion?: string;
  shortcuts: {
    newNote: string;
    restoreWindow: string;
    showAllHiddenWindows: string;
    toggleVisibleWindows: string;
    toggleAlwaysOnTop: string;
    toggleReadOnly: string;
    toggleTheme: string;
    hideWindow: string;
    closeWindow: string;
    deleteNote: string;
  };
}

export interface SettingsSnapshot {
  revision: number;
  settings: Settings;
}

export const DEFAULT_SETTINGS = defaults as Settings;

export function resolveEditorFontFamily(value: EditorFontFamily) {
  if (value === "serif") {
    return 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
  }
  if (value === "mono") {
    return '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  }
  return "system-ui, -apple-system, sans-serif";
}
