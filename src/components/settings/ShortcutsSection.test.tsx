// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/stores/settings";
import { ShortcutsSection } from "./ShortcutsSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

const update = vi.fn();
let container: HTMLDivElement;
let root: Root;

async function render(settings: Partial<Settings>) {
  await act(async () =>
    root.render(
      <ShortcutsSection
        settings={{ ...DEFAULT_SETTINGS, ...settings }}
        shortcutError={null}
        globalShortcutRegistration={{
          newNote: true,
          restoreWindow: true,
          showAllHiddenWindows: true,
          toggleVisibleWindows: true,
        }}
        updateShortcut={() => {}}
        updateSettings={update}
      />,
    ),
  );
}

function group(label: string) {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing group: ${label}`);
  return element;
}

function item(groupLabel: string, text: string) {
  const button = Array.from(
    group(groupLabel).querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent === text);
  if (!button) throw new Error(`Missing item: ${text}`);
  return button;
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  update.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("drag mouse buttons turn on and off independently", async () => {
  await render({ dragMouseButtons: ["middle"] });
  const buttons = "shortcuts.dragButton.mouseButtons";
  await click(item(buttons, "shortcuts.mouseButtons.right"));
  expect(update).toHaveBeenLastCalledWith({
    dragMouseButtons: ["middle", "right"],
  });
  await click(item(buttons, "shortcuts.mouseButtons.middle"));
  expect(update).toHaveBeenLastCalledWith({ dragMouseButtons: [] });
});

test("clicking the chosen drag modifier turns modifier dragging off", async () => {
  const modifiers = "shortcuts.dragButton.modifiers";
  const alt = "shortcuts.dragButton.withLeft:shortcuts.modifiers.alt";
  const ctrl = "shortcuts.dragButton.withLeft:shortcuts.modifiers.ctrl";
  await render({ dragModifier: "alt" });
  expect(
    Array.from(group(modifiers).querySelectorAll("button"), (button) =>
      button.textContent?.split(".").pop(),
    ),
  ).toEqual(["alt", "ctrl", "meta"]);
  await click(item(modifiers, ctrl));
  expect(update).toHaveBeenLastCalledWith({ dragModifier: "ctrl" });
  await click(item(modifiers, alt));
  expect(update).toHaveBeenLastCalledWith({ dragModifier: "none" });
});

test("clicking the chosen wheel modifier turns the wheel action off", async () => {
  await render({ wheelResizeModifier: "alt", wheelOpacityModifier: "ctrl" });
  await click(item("shortcuts.wheelResize.label", "shortcuts.modifiers.alt"));
  expect(update).toHaveBeenLastCalledWith({ wheelResizeModifier: "none" });
  await click(
    item("shortcuts.wheelOpacity.label", "shortcuts.modifiers.shift"),
  );
  expect(update).toHaveBeenLastCalledWith({ wheelOpacityModifier: "shift" });
});

function interactions() {
  return Array.from(
    container.querySelectorAll("div"),
    (element) => element.textContent ?? "",
  ).filter(
    (text) =>
      text.startsWith("shortcuts.currentInteractions.") &&
      !text.startsWith("shortcuts.currentInteractions.label"),
  );
}

test("current interactions list every way to reach each action", async () => {
  await render({
    wheelResizeModifier: "alt",
    wheelOpacityModifier: "none",
    dragMouseButtons: ["middle", "right"],
    dragModifier: "ctrl",
  });
  expect(interactions()).toEqual([
    "shortcuts.currentInteractions.resize:shortcuts.wheelWith:shortcuts.modifiers.alt",
    "shortcuts.currentInteractions.move:shortcuts.currentInteractions.methods.edgeDragshortcuts.currentInteractions.separatorshortcuts.currentInteractions.methods.middleDragshortcuts.currentInteractions.separatorshortcuts.currentInteractions.methods.rightDragshortcuts.currentInteractions.separatorshortcuts.currentInteractions.methods.leftDrag:shortcuts.modifiers.ctrl",
    "shortcuts.currentInteractions.alwaysOnTop:shortcuts.currentInteractions.methods.middleClick",
    "shortcuts.currentInteractions.menu:shortcuts.currentInteractions.methods.rightClick",
  ]);
  await render({
    wheelResizeModifier: "none",
    wheelOpacityModifier: "none",
    dragMouseButtons: [],
    dragModifier: "none",
  });
  expect(interactions()[0]).toBe(
    "shortcuts.currentInteractions.move:shortcuts.currentInteractions.methods.edgeDrag",
  );
});

test("restoring defaults asks first and then resets every shortcut", async () => {
  const button = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (element) => element.textContent === "shortcuts.reset.label",
    );
  await render({});
  expect(button()?.disabled).toBe(true);
  await render({
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, newNote: "Ctrl+Alt+N" },
  });
  const reset = button();
  if (!reset) throw new Error("Missing reset button");
  expect(reset.disabled).toBe(false);
  await click(reset);
  expect(update).not.toHaveBeenCalled();
  const confirm = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
  ).find((element) => element.textContent === "shortcuts.reset.confirm");
  if (!confirm) throw new Error("Missing confirm button");
  await click(confirm);
  expect(update).toHaveBeenCalledWith({
    shortcuts: DEFAULT_SETTINGS.shortcuts,
  });
});
