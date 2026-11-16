// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type ContextMenuItem, DEFAULT_SETTINGS } from "@/stores/settings";
import ContextMenuApp from "./ContextMenuApp";

const mocks = vi.hoisted(() => ({
  setSize: vi.fn(async () => {}),
  setPosition: vi.fn(async (_position: { x: number; y: number }) => {}),
  factor: 1,
  workHeight: 1080,
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
    scaleFactor: async () => mocks.factor,
    innerSize: async () => ({ width: 224, height: 180 }),
    outerPosition: async () => ({ x: 0, y: 0 }),
    setSize: mocks.setSize,
    setPosition: mocks.setPosition,
  }),
  monitorFromPoint: async () => ({
    workArea: {
      position: { x: 0, y: 0 },
      size: { width: 1920, height: mocks.workHeight },
    },
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
  listenNoteContextMenuSync: async () => () => {},
  emitNoteContextMenuAction: mocks.emitAction,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
const observers: { callback: () => void; elements: Set<Element> }[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.factor = 1;
  mocks.workHeight = 1080;
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

async function renderMenu(alwaysOnTop = false) {
  await act(async () =>
    root.render(
      <ContextMenuApp
        targetWindowLabel="note"
        noteId="test"
        notePath="test.md"
        anchorX={100}
        anchorY={100}
        noteOpacity={1}
        noteReadOnly={false}
        maximized={false}
        alwaysOnTop={alwaysOnTop}
      />,
    ),
  );
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  const panel = container.querySelector<HTMLElement>(
    ".pinote-context-menu-panel",
  );
  if (!panel) throw new Error("Missing menu panel");
  return panel;
}

test.each([
  { factor: 1, workHeight: 1080, expectedHeight: 240 },
  { factor: 1.25, workHeight: 1080, expectedHeight: 300 },
  { factor: 1.25, workHeight: 200, expectedHeight: 300 },
])("uses full content height: $factor / $workHeight", async ({
  factor,
  workHeight,
  expectedHeight,
}) => {
  mocks.factor = factor;
  mocks.workHeight = workHeight;
  const panel = await renderMenu();
  expect(mocks.setSize).toHaveBeenCalledWith(
    expect.objectContaining({ height: expectedHeight }),
  );
  expect(panel.textContent).toContain("closeWindow");
  expect(panel.textContent).toContain("deleteNote");
  expect(
    mocks.setPosition.mock.calls.every(
      ([position]) =>
        position.y >= 8 &&
        position.y <= Math.max(8, workHeight - expectedHeight - 8),
    ),
  ).toBe(true);
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
