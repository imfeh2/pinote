import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { LanguagePreference } from "@/i18n/locale";
import { logError } from "@/lib/logger";

type Theme = "light" | "dark" | "system";
export type EditorFontFamily = "system" | "serif" | "mono";
export type WheelResizeModifier = "alt" | "ctrl" | "shift" | "meta";
export type WindowsGlassEffect = "none" | "mica" | "acrylic" | "blur";
export type DragMouseButton = "middle" | "right";
const SETTINGS_FILE = "settings.json";
const LEGACY_DEFAULT_SHORTCUTS = {
  restoreWindow: "Alt+N",
  showAllHiddenWindows: "Alt+Shift+H",
  toggleVisibleWindows: "Alt+Shift+N",
  toggleAlwaysOnTop: "Ctrl+Shift+T",
  toggleReadOnly: "Alt+R",
  toggleTheme: "Ctrl+Shift+D",
  hideWindow: "Escape",
  closeWindow: "Ctrl+Shift+W",
} as const;

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
  launchAtStartup: boolean;
  hideNoteWindowsFromTaskbar: boolean;
  contextMenuFollowNoteOpacity: boolean;
  wheelResizeModifier: WheelResizeModifier;
  wheelOpacityModifier: WheelResizeModifier;
  dragMouseButton: DragMouseButton;
  openWithPinoteContextMenu: boolean;
  defaultMarkdownOpenWithPinote: boolean;
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

export const DEFAULT_SETTINGS: Settings = {
  language: "system",
  theme: "system",
  newNoteDirectory: "",
  noteGlassEffectWindows: "none",
  noteGlassEffectMacos: true,
  editorFontFamily: "system",
  editorFontSize: 15,
  editorLineHeight: 1.2,
  editorPaddingX: 10,
  editorPaddingY: 10,
  launchAtStartup: false,
  hideNoteWindowsFromTaskbar: true,
  contextMenuFollowNoteOpacity: false,
  wheelResizeModifier: "alt",
  wheelOpacityModifier: "ctrl",
  dragMouseButton: "middle",
  openWithPinoteContextMenu: false,
  defaultMarkdownOpenWithPinote: false,
  pendingUpdatePromptVersion: "",
  dismissedUpdateVersion: "",
  shortcuts: {
    newNote: "Alt+C",
    restoreWindow: "Alt+S",
    showAllHiddenWindows: "Alt+Shift+H",
    toggleVisibleWindows: "Alt+D",
    toggleAlwaysOnTop: "Alt+A",
    toggleReadOnly: "Alt+R",
    toggleTheme: "Ctrl+Shift+D",
    hideWindow: "Escape",
    closeWindow: "Ctrl+Shift+W",
    deleteNote: "Alt+Y",
  },
};

type StoredSettings = Partial<Omit<Settings, "shortcuts">> & {
  shortcuts?: Partial<Settings["shortcuts"]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeNewNoteDirectory(value: unknown) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.newNoteDirectory;
  return value.trim();
}

function sanitizeWheelModifier(
  value: unknown,
  fallback: WheelResizeModifier,
): WheelResizeModifier {
  if (
    value === "alt" ||
    value === "ctrl" ||
    value === "shift" ||
    value === "meta"
  ) {
    return value;
  }
  return fallback;
}

function sanitizeDragMouseButton(value: unknown): DragMouseButton {
  if (value === "middle" || value === "right") return value;
  return DEFAULT_SETTINGS.dragMouseButton;
}

function sanitizeWindowsGlassEffect(value: unknown): WindowsGlassEffect {
  if (
    value === "none" ||
    value === "mica" ||
    value === "acrylic" ||
    value === "blur"
  ) {
    return value;
  }
  return DEFAULT_SETTINGS.noteGlassEffectWindows;
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function sanitizeLanguage(value: unknown): LanguagePreference {
  if (value === "system" || value === "en-US" || value === "zh-CN")
    return value;
  return DEFAULT_SETTINGS.language;
}

function stripExtraFields(
  stored: StoredSettings,
): Partial<Omit<Settings, "shortcuts">> {
  const copy = { ...stored } as Record<string, unknown>;
  delete copy.shortcuts;
  delete copy.noteGlassBlur;
  return copy as Partial<Omit<Settings, "shortcuts">>;
}

function mergeSettings(stored: StoredSettings): Settings {
  const { shortcuts } = stored;
  const rest = stripExtraFields(stored);
  const mergedShortcuts = {
    ...DEFAULT_SETTINGS.shortcuts,
    ...shortcuts,
  };
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    language: sanitizeLanguage(rest.language),
    newNoteDirectory: sanitizeNewNoteDirectory(rest.newNoteDirectory),
    noteGlassEffectWindows: sanitizeWindowsGlassEffect(
      rest.noteGlassEffectWindows,
    ),
    noteGlassEffectMacos: sanitizeBoolean(
      rest.noteGlassEffectMacos,
      DEFAULT_SETTINGS.noteGlassEffectMacos,
    ),
    contextMenuFollowNoteOpacity: sanitizeBoolean(
      rest.contextMenuFollowNoteOpacity,
      DEFAULT_SETTINGS.contextMenuFollowNoteOpacity,
    ),
    wheelResizeModifier: sanitizeWheelModifier(
      rest.wheelResizeModifier,
      DEFAULT_SETTINGS.wheelResizeModifier,
    ),
    wheelOpacityModifier: sanitizeWheelModifier(
      rest.wheelOpacityModifier,
      DEFAULT_SETTINGS.wheelOpacityModifier,
    ),
    dragMouseButton: sanitizeDragMouseButton(rest.dragMouseButton),
    shortcuts: mergedShortcuts,
  };
}

function shouldMigrateLegacyShortcutDefaults(shortcuts: Settings["shortcuts"]) {
  return (
    shortcuts.restoreWindow === LEGACY_DEFAULT_SHORTCUTS.restoreWindow &&
    shortcuts.showAllHiddenWindows ===
      LEGACY_DEFAULT_SHORTCUTS.showAllHiddenWindows &&
    shortcuts.toggleVisibleWindows ===
      LEGACY_DEFAULT_SHORTCUTS.toggleVisibleWindows &&
    shortcuts.toggleAlwaysOnTop ===
      LEGACY_DEFAULT_SHORTCUTS.toggleAlwaysOnTop &&
    shortcuts.toggleReadOnly === LEGACY_DEFAULT_SHORTCUTS.toggleReadOnly &&
    shortcuts.toggleTheme === LEGACY_DEFAULT_SHORTCUTS.toggleTheme &&
    shortcuts.hideWindow === LEGACY_DEFAULT_SHORTCUTS.hideWindow &&
    shortcuts.closeWindow === LEGACY_DEFAULT_SHORTCUTS.closeWindow
  );
}

function migrateLegacyShortcutDefaults(settings: Settings) {
  if (!shouldMigrateLegacyShortcutDefaults(settings.shortcuts)) {
    return { settings, migrated: false };
  }
  return {
    settings: {
      ...settings,
      shortcuts: {
        ...settings.shortcuts,
        restoreWindow: DEFAULT_SETTINGS.shortcuts.restoreWindow,
        toggleVisibleWindows: DEFAULT_SETTINGS.shortcuts.toggleVisibleWindows,
        toggleAlwaysOnTop: DEFAULT_SETTINGS.shortcuts.toggleAlwaysOnTop,
        toggleReadOnly: DEFAULT_SETTINGS.shortcuts.toggleReadOnly,
      },
    },
    migrated: true,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const fileExists = await exists(SETTINGS_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    if (!fileExists) return { ...DEFAULT_SETTINGS };

    const content = await readTextFile(SETTINGS_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    const merged = mergeSettings(parsed as StoredSettings);
    const { settings, migrated } = migrateLegacyShortcutDefaults(merged);
    if (migrated) {
      await saveSettings(settings);
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await writeTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (e) {
    logError("settings", "save_failed", e);
  }
}
