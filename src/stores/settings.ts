import type { LanguagePreference } from "@/i18n/locale";
import type { NoteContextMenuAction } from "@/lib/contextMenuApi";
import defaults from "@/settings.defaults.json";

type Theme = "light" | "dark" | "system";
export type WheelResizeModifier = "none" | "alt" | "ctrl" | "shift" | "meta";
export type WindowsGlassEffect = "none" | "mica" | "acrylic" | "blur";
export type DragMouseButton = "middle" | "right";
export type DragModifier = "none" | "alt" | "ctrl" | "meta";

export interface EditorFont {
  family: string;
  enabled: boolean;
}

export interface ContextMenuItem {
  action: NoteContextMenuAction;
  visible: boolean;
}

export interface Settings {
  language: LanguagePreference;
  theme: Theme;
  newNoteDirectory: string;
  noteGlassEffectWindows: WindowsGlassEffect;
  noteGlassEffectMacos: boolean;
  editorFontFamily: EditorFont[];
  editorFontSize: number;
  editorLineHeight: number;
  editorFontWeight: number;
  editorPaddingX: number;
  editorPaddingY: number;
  hideNoteWindowsFromTaskbar: boolean;
  contextMenuFollowNoteOpacity: boolean;
  confirmNoteDeletion: boolean;
  wheelResizeModifier: WheelResizeModifier;
  wheelOpacityModifier: WheelResizeModifier;
  dragMouseButtons: DragMouseButton[];
  dragModifier: DragModifier;
  contextMenuItems: ContextMenuItem[];
  lastUpdateCheckAt?: string;
  pendingUpdatePromptVersion?: string;
  dismissedUpdateVersion?: string;
  lastRunVersion?: string;
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

export function resolveEditorFontFamily(fonts: EditorFont[]) {
  return [
    ...fonts
      .filter((font) => font.enabled)
      .map((font) => `"${font.family.replace(/["\\]/g, "\\$&")}"`),
    "system-ui",
    "-apple-system",
    "sans-serif",
  ].join(", ");
}
