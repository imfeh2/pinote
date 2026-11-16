// @vitest-environment happy-dom

import type { getCurrentWindow } from "@tauri-apps/api/window";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useNoteWindowMouseInteractions } from "@/hooks/useNoteWindowMouseInteractions";
import type {
  DragModifier,
  DragMouseButton,
  WheelResizeModifier,
} from "@/stores/settings";

const mocks = vi.hoisted(() => ({
  startDragging: vi.fn(),
  setPosition: vi.fn(),
  toggleAlwaysOnTop: vi.fn(),
  openNoteContextMenu: vi.fn(),
}));

vi.mock("@/lib/contextMenuApi", () => ({
  closeNoteContextMenu: async () => {},
  openNoteContextMenu: mocks.openNoteContextMenu,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

const appWindow = {
  startDragging: mocks.startDragging,
  setPosition: mocks.setPosition,
  outerPosition: async () => ({ x: 100, y: 100 }),
  scaleFactor: async () => 1,
} as unknown as ReturnType<typeof getCurrentWindow>;

function Harness({
  dragMouseButtons,
  dragModifier,
  wheelResizeModifier,
}: {
  dragMouseButtons: DragMouseButton[];
  dragModifier: DragModifier;
  wheelResizeModifier: WheelResizeModifier;
}) {
  useNoteWindowMouseInteractions({
    appWindow,
    interactionBlocked: false,
    noteId: "note",
    notePath: "/notes/note.md",
    windowLabel: "note",
    dragMouseButtons,
    dragModifier,
    wheelOpacityModifier: "ctrl",
    wheelResizeModifier,
    noteOpacityRef: { current: 1 },
    noteReadOnlyRef: { current: false },
    noteScrollTopRef: { current: 0 },
    persistWindowState: async () => true,
    setNoteOpacityState: () => {},
    toggleAlwaysOnTop: mocks.toggleAlwaysOnTop,
  });
  return null;
}

let cleanup = async () => {};

async function render(
  dragMouseButtons: DragMouseButton[],
  dragModifier: DragModifier,
  wheelResizeModifier: WheelResizeModifier = "alt",
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <Harness
        dragMouseButtons={dragMouseButtons}
        dragModifier={dragModifier}
        wheelResizeModifier={wheelResizeModifier}
      />,
    ),
  );
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
}

function mouse(type: string, init: MouseEventInit) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

async function drag(button: number) {
  await act(async () => {
    mouse("mousedown", { button, screenX: 10, screenY: 10 });
    await Promise.resolve();
  });
  await act(async () => {
    mouse("mousemove", { button, screenX: 40, screenY: 30 });
    await Promise.resolve();
  });
  await act(async () => {
    mouse("mouseup", { button, screenX: 40, screenY: 30 });
  });
}

beforeEach(() => {
  mocks.startDragging.mockReset().mockResolvedValue(undefined);
  mocks.setPosition.mockReset().mockResolvedValue(undefined);
  mocks.toggleAlwaysOnTop.mockReset();
  mocks.openNoteContextMenu.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

test("the chosen modifier with the left button starts a native window drag", async () => {
  await render(["middle"], "ctrl");
  const plain = mouse("mousedown", { button: 0 });
  const otherModifier = mouse("mousedown", { button: 0, altKey: true });
  const extraModifier = mouse("mousedown", {
    button: 0,
    ctrlKey: true,
    shiftKey: true,
  });
  expect(mocks.startDragging).not.toHaveBeenCalled();
  expect(plain.defaultPrevented).toBe(false);
  expect(otherModifier.defaultPrevented).toBe(false);
  expect(extraModifier.defaultPrevented).toBe(false);
  const matched = mouse("mousedown", { button: 0, ctrlKey: true });
  expect(matched.defaultPrevented).toBe(true);
  expect(mocks.startDragging).toHaveBeenCalledOnce();
});

test("no modifier leaves the left button to the editor", async () => {
  await render(["middle"], "none");
  for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
    const event = mouse("mousedown", { button: 0, [modifier]: true });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(mocks.startDragging).not.toHaveBeenCalled();
});

test("middle and right drags can both move the window", async () => {
  await render(["middle", "right"], "alt");
  await drag(1);
  expect(mocks.setPosition).toHaveBeenCalled();
  expect(mocks.toggleAlwaysOnTop).not.toHaveBeenCalled();
  mocks.setPosition.mockClear();
  await drag(2);
  expect(mocks.setPosition).toHaveBeenCalled();
  expect(mocks.openNoteContextMenu).not.toHaveBeenCalled();
});

test("with no drag buttons, middle click still pins and right click is left alone", async () => {
  await render([], "alt");
  await drag(1);
  expect(mocks.setPosition).not.toHaveBeenCalled();
  await act(async () => {
    mouse("mousedown", { button: 1 });
    mouse("mouseup", { button: 1 });
  });
  expect(mocks.toggleAlwaysOnTop).toHaveBeenCalledOnce();
  const right = mouse("mousedown", { button: 2 });
  expect(right.defaultPrevented).toBe(false);
});

test("a wheel action set to no modifier leaves the wheel alone", async () => {
  const wheel = () => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    Object.defineProperty(event, "altKey", { value: true });
    document.body.dispatchEvent(event);
    return event;
  };
  await render(["middle"], "alt", "alt");
  expect(wheel().defaultPrevented).toBe(true);
  await cleanup();
  await render(["middle"], "alt", "none");
  expect(wheel().defaultPrevented).toBe(false);
});
