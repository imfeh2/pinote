// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ContextMenuApp from "./ContextMenuApp";

const mocks = vi.hoisted(() => ({
  setSize: vi.fn(async () => {}),
  setPosition: vi.fn(async (_position: { x: number; y: number }) => {}),
  factor: 1,
  workHeight: 1080,
  contentHeight: 240,
  hideTaskbar: true,
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
    settings: { hideNoteWindowsFromTaskbar: mocks.hideTaskbar },
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

async function renderMenu() {
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
  const panel = await renderMenu();
  const buttons = Array.from(panel.querySelectorAll("button")).slice(1);
  const actions = [
    "new-note",
    "open-settings",
    "minimize-window",
    "toggle-maximize",
    "toggle-read-only",
    "hide-window",
    "close-window",
    "delete-note",
  ];
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
