import type {
  DragMouseButton,
  WheelResizeModifier,
  WindowsGlassEffect,
} from "@/stores/settings";

export const globalShortcutKeys = [
  "newNote",
  "restoreWindow",
  "showAllHiddenWindows",
  "toggleVisibleWindows",
] as const;

export type GlobalShortcutKey = (typeof globalShortcutKeys)[number];

export const shortcutItems = [
  { key: "newNote", labelKey: "shortcuts.items.newNote" },
  { key: "restoreWindow", labelKey: "shortcuts.items.restoreWindow" },
  {
    key: "showAllHiddenWindows",
    labelKey: "shortcuts.items.showAllHiddenWindows",
  },
  {
    key: "toggleVisibleWindows",
    labelKey: "shortcuts.items.toggleVisibleWindows",
  },
  { key: "toggleAlwaysOnTop", labelKey: "shortcuts.items.toggleAlwaysOnTop" },
  { key: "toggleReadOnly", labelKey: "shortcuts.items.toggleReadOnly" },
  { key: "toggleTheme", labelKey: "shortcuts.items.toggleTheme" },
  { key: "hideWindow", labelKey: "shortcuts.items.hideWindow" },
  { key: "closeWindow", labelKey: "shortcuts.items.closeWindow" },
  { key: "deleteNote", labelKey: "shortcuts.items.deleteNote" },
] as const;

export type ShortcutKey = (typeof shortcutItems)[number]["key"];

export const themeOptions = [
  { value: "system", labelKey: "appearance.theme.options.system" },
  { value: "light", labelKey: "appearance.theme.options.light" },
  { value: "dark", labelKey: "appearance.theme.options.dark" },
] as const;

export const fontFamilyOptions = [
  {
    value: "system",
    labelKey: "appearance.typography.fontFamilyOptions.system",
  },
  { value: "serif", labelKey: "appearance.typography.fontFamilyOptions.serif" },
  { value: "mono", labelKey: "appearance.typography.fontFamilyOptions.mono" },
] as const;

export const wheelResizeModifierOptions: Array<{
  value: WheelResizeModifier;
  labelKey: string;
}> = [
  { value: "alt", labelKey: "shortcuts.modifiers.alt" },
  { value: "ctrl", labelKey: "shortcuts.modifiers.ctrl" },
  { value: "shift", labelKey: "shortcuts.modifiers.shift" },
  { value: "meta", labelKey: "shortcuts.modifiers.meta" },
];

export const dragMouseButtonOptions: Array<{
  value: DragMouseButton;
  labelKey: string;
}> = [
  { value: "middle", labelKey: "shortcuts.mouseButtons.middle" },
  { value: "right", labelKey: "shortcuts.mouseButtons.right" },
];

export const windowsGlassEffectOptions: Array<{
  value: WindowsGlassEffect;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: "none",
    labelKey: "appearance.glass.options.none",
    descriptionKey: "appearance.glass.options.noneDescription",
  },
  {
    value: "mica",
    labelKey: "appearance.glass.options.mica",
    descriptionKey: "appearance.glass.options.micaDescription",
  },
  {
    value: "acrylic",
    labelKey: "appearance.glass.options.acrylic",
    descriptionKey: "appearance.glass.options.acrylicDescription",
  },
  {
    value: "blur",
    labelKey: "appearance.glass.options.blur",
    descriptionKey: "appearance.glass.options.blurDescription",
  },
];

export const sections = [
  {
    id: "appearance",
    labelKey: "sections.appearance.label",
    descriptionKey: "sections.appearance.description",
  },
  {
    id: "preferences",
    labelKey: "sections.preferences.label",
    descriptionKey: "sections.preferences.description",
  },
  {
    id: "window",
    labelKey: "sections.window.label",
    descriptionKey: "sections.window.description",
  },
  {
    id: "shortcuts",
    labelKey: "sections.shortcuts.label",
    descriptionKey: "sections.shortcuts.description",
  },
  {
    id: "history",
    labelKey: "sections.history.label",
    descriptionKey: "sections.history.description",
  },
  {
    id: "changelog",
    labelKey: "sections.changelog.label",
    descriptionKey: "sections.changelog.description",
  },
  {
    id: "about",
    labelKey: "sections.about.label",
    descriptionKey: "sections.about.description",
  },
] as const;

export type SettingsSection = (typeof sections)[number]["id"];
