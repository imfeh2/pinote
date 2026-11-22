// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NoteContextMenuContext } from "@/lib/contextMenuApi";
import { type ContextMenuItem, DEFAULT_SETTINGS } from "@/stores/settings";
import ContextMenuApp from "./ContextMenuApp";

const mocks = vi.hoisted(() => ({
  setSize: vi.fn(async (_size: { width: number; height: number }) => {}),
  show: vi.fn(async () => {}),
  sync: null as ((context: NoteContextMenuContext) => void) | null,
  contentHeight: 240,
  hideTaskbar: true,
  items: [] as ContextMenuItem[],
  emitAction: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "menu",
    hide: async () => {},
    onFocusChanged: async () => () => {},
    setSize: mocks.setSize,
  }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      hideNoteWindowsFromTaskbar: mocks.hideTaskbar,
      contextMenuItems: mocks.items,
    },
  }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => {} }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/contextMenuApi", () => ({
  listenNoteContextMenuSync: async (
    handler: (context: NoteContextMenuContext) => void,
  ) => {
    mocks.sync = handler;
    return () => {};
  },
  emitNoteContextMenuAction: mocks.emitAction,
  showNoteContextMenu: mocks.show,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
const observers: { callback: () => void; elements: Set<Element> }[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.sync = null;
  mocks.contentHeight = 240;
  mocks.hideTaskbar = true;
  mocks.items = DEFAULT_SETTINGS.contextMenuItems;
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      elements = new Set<Element>();
      constructor(callback: () => void) {
        observers.push({ callback, elements: this.elements });
      }
      observe(element: Element) {
        this.elements.add(element);
      }
      disconnect() {
        this.elements.clear();
      }
    },
  );
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
    window.clearTimeout,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 120, 180),
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => mocks.contentHeight,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function context(
  overrides: Partial<NoteContextMenuContext> = {},
): NoteContextMenuContext {
  return {
    targetWindowLabel: "note",
    noteId: "test",
    notePath: "test.md",
    noteOpacity: 1,
    noteReadOnly: false,
    maximized: false,
    alwaysOnTop: false,
    ...overrides,
  };
}

async function openMenu(overrides: Partial<NoteContextMenuContext> = {}) {
  await act(async () => mocks.sync?.(context(overrides)));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

async function renderMenu(alwaysOnTop = false) {
  await act(async () => root.render(<ContextMenuApp />));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  await openMenu({ alwaysOnTop });
  const panel = container.querySelector<HTMLElement>(
    ".pinote-context-menu-panel",
  );
  if (!panel) throw new Error("Missing menu panel");
  return panel;
}

test("sizes the hidden window to its content before the first open", async () => {
  await act(async () => root.render(<ContextMenuApp />));
  expect(mocks.setSize).toHaveBeenCalledWith(
    expect.objectContaining({ height: 240 }),
  );
  expect(mocks.show).not.toHaveBeenCalled();
});

test("shows the menu after the new note is in place", async () => {
  await act(async () => root.render(<ContextMenuApp />));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  let shownTitle: string | null = null;
  mocks.show.mockImplementation(async () => {
    shownTitle = container.textContent;
  });
  await openMenu({ noteId: "second" });
  expect(mocks.show).toHaveBeenCalledTimes(1);
  expect(shownTitle).toContain("second");
});

test("menu size does not depend on the note state", async () => {
  await renderMenu();
  const calls = mocks.setSize.mock.calls.length;
  await openMenu({ alwaysOnTop: true, maximized: true, noteReadOnly: true });
  expect(mocks.setSize).toHaveBeenCalledTimes(calls);
  const toggle = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "disableAlwaysOnTop",
  );
  expect(
    toggle
      ?.querySelector("[data-alternative]")
      ?.getAttribute("data-alternative"),
  ).toBe("enableAlwaysOnTop");
});

test("all menu actions share layout and interaction styles while retaining their actions", async () => {
  mocks.hideTaskbar = false;
  mocks.items = DEFAULT_SETTINGS.contextMenuItems.map((item) => ({
    ...item,
    visible: true,
  }));
  const panel = await renderMenu();
  const buttons = Array.from(panel.querySelectorAll("button")).slice(1);
  const actions = mocks.items.map((item) => item.action);
  const colors = new Set([
    "text-foreground",
    "hover:text-accent-foreground",
    "text-red-700",
    "hover:text-red-700",
    "[[data-theme=dark]_&]:text-red-400",
    "[[data-theme=dark]_&]:hover:text-red-400",
  ]);
  const sharedClasses = (button: HTMLButtonElement) =>
    Array.from(button.classList)
      .filter((name) => !colors.has(name))
      .sort();
  expect(buttons).toHaveLength(actions.length);
  for (const [index, button] of buttons.entries()) {
    expect(sharedClasses(button)).toEqual(sharedClasses(buttons[0]));
    expect(button.classList.contains("border-0")).toBe(true);
    expect(button.classList.contains("cursor-pointer")).toBe(true);
    await act(async () => button.click());
    expect(mocks.emitAction).toHaveBeenLastCalledWith("note", actions[index]);
  }
  expect(buttons[buttons.length - 1].classList.contains("text-red-700")).toBe(
    true,
  );
});

test("remeasures changing content height", async () => {
  const panel = await renderMenu();
  const content = panel.lastElementChild;
  const observer = observers.find(
    ({ elements }) => content && elements.has(content),
  );
  expect(observer).toBeDefined();
  mocks.contentHeight = 280;
  await act(async () => observer?.callback());
  expect(mocks.setSize).toHaveBeenLastCalledWith(
    expect.objectContaining({ height: 280 }),
  );
});

test("menu shows the chosen items in the chosen order", async () => {
  mocks.hideTaskbar = true;
  mocks.items = [
    { action: "delete-note", visible: true },
    { action: "toggle-always-on-top", visible: true },
    { action: "minimize-window", visible: true },
    { action: "new-note", visible: false },
    { action: "show-all-hidden-windows", visible: true },
  ];
  const labels = async (alwaysOnTop: boolean) =>
    Array.from(
      (await renderMenu(alwaysOnTop)).querySelectorAll("button"),
      (button) => button.textContent,
    ).slice(1);
  expect(await labels(false)).toEqual([
    "deleteNote",
    "enableAlwaysOnTop",
    "showAllHiddenWindows",
  ]);
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(await labels(true)).toContain("disableAlwaysOnTop");
});

test("menu without items shows only the note title", async () => {
  mocks.items = DEFAULT_SETTINGS.contextMenuItems.map((item) => ({
    ...item,
    visible: false,
  }));
  const panel = await renderMenu();
  expect(panel.querySelectorAll("button")).toHaveLength(1);
  expect(panel.querySelector(".bg-border")).toBeNull();
});
