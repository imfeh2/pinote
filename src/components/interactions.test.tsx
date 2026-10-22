// @vitest-environment happy-dom

import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ContextMenuApp from "@/ContextMenuApp";
import { Editor } from "@/components/Editor";
import { HistorySection } from "@/components/settings/HistorySection";
import { WindowDragHandle } from "@/components/WindowDragHandle";
import type { NoteContextMenuContext } from "@/lib/contextMenuApi";

const mocks = vi.hoisted(() => ({
  position: { x: 100, y: 50 },
  outerPosition: vi.fn(),
  setPosition: vi.fn(),
  setSize: vi.fn(),
  readTextFile: vi.fn<() => Promise<string>>(),
  menuSync: null as ((context: NoteContextMenuContext) => void) | null,
  view: null as EditorView | null,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "test",
    outerPosition: mocks.outerPosition,
    setPosition: mocks.setPosition,
    setSize: mocks.setSize,
    scaleFactor: async () => 1,
    innerSize: async () => ({ width: 10, height: 10 }),
    onFocusChanged: async () => () => {},
    hide: async () => {},
  }),
  monitorFromPoint: async () => null,
}));
vi.mock("@tauri-apps/plugin-fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-fs")>()),
  readTextFile: mocks.readTextFile,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/useSettings", async () => {
  const { DEFAULT_SETTINGS } = await import("@/stores/settings");
  return { useSettings: () => ({ settings: DEFAULT_SETTINGS }) };
});
vi.mock("@/lib/contextMenuApi", () => ({
  emitNoteContextMenuAction: vi.fn(),
  listenNoteContextMenuSync: async (
    listener: (context: NoteContextMenuContext) => void,
  ) => {
    mocks.menuSync = listener;
    return () => {
      mocks.menuSync = null;
    };
  },
}));
vi.mock("@milkdown/react", () => {
  const editor = {
    action: (callback: (ctx: { get: () => EditorView | null }) => void) =>
      callback({ get: () => mocks.view }),
  };
  const getInstance = () => editor;
  return {
    useEditor: () => {},
    useInstance: () => [false, getInstance],
    MilkdownProvider: ({ children }: { children: ReactNode }) => children,
    Milkdown: () => (
      <div
        ref={(node) => {
          if (node && mocks.view) node.append(mocks.view.dom);
        }}
      />
    ),
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.position = { x: 100, y: 50 };
  mocks.outerPosition.mockImplementation(async () => ({ ...mocks.position }));
  mocks.setPosition.mockImplementation(
    async (position: { x: number; y: number }) => {
      mocks.position = { x: position.x, y: position.y };
    },
  );
  mocks.setSize.mockResolvedValue(undefined);
  mocks.readTextFile.mockResolvedValue("Note content");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mocks.view?.destroy();
  mocks.view = null;
  container.remove();
  vi.useRealTimers();
});

function button(label: string) {
  const element = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

test("window mover preserves pointer dragging and serializes keyboard moves", async () => {
  const drag = vi.fn();
  await act(async () => root.render(<WindowDragHandle onMouseDown={drag} />));
  const handle = button("Move window");
  await key(handle, "ArrowRight");
  expect(mocks.setPosition).not.toHaveBeenCalled();
  await act(async () => handle.click());
  expect(handle.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    for (const value of ["ArrowRight", "ArrowDown", "ArrowRight"]) {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  });
  expect(mocks.position).toEqual({ x: 120, y: 60 });
  await key(handle, "Escape");
  await key(handle, "ArrowLeft");
  expect(mocks.position).toEqual({ x: 120, y: 60 });
  expect(handle.getAttribute("aria-pressed")).toBe("false");
  await act(async () => {
    handle.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
    handle.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
  });
  expect(drag).toHaveBeenCalledOnce();
  expect(handle.getAttribute("aria-pressed")).toBe("false");
});

test("blank editor space adds one paragraph from keyboard and preserves pointer distance and read-only", async () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*", toDOM: () => ["p", 0] },
      text: {},
    },
  });
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ schema }),
  });
  mocks.view = view;
  view.dom.style.lineHeight = "20px";
  vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 100),
  );
  const focus = vi.spyOn(view, "focus").mockImplementation(() => {});
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <Editor defaultValue="" initialScrollTop={40} onChange={onChange} />,
    ),
  );
  await act(async () => button("Add paragraph").click());
  expect(view.state.doc.childCount).toBe(2);
  await act(async () =>
    button("Add paragraph").dispatchEvent(
      new MouseEvent("click", { detail: 1, clientY: 160, bubbles: true }),
    ),
  );
  expect(view.state.doc.childCount).toBe(5);
  expect(focus).toHaveBeenCalledTimes(2);
  await act(async () =>
    root.render(
      <Editor
        defaultValue=""
        initialScrollTop={80}
        readOnly
        onChange={onChange}
      />,
    ),
  );
  await act(async () => button("Add paragraph").click());
  expect(button("Add paragraph").disabled).toBe(true);
  expect(view.state.doc.childCount).toBe(5);
  expect(container.querySelector(".milkdown-editor")?.scrollTop).toBe(80);
  const scroller = container.querySelector(".milkdown-editor");
  if (!scroller) throw new Error("Missing editor scroller");
  scroller.scrollTop = 200;
  await act(async () =>
    root.render(
      <Editor
        key="reload"
        defaultValue="Reloaded"
        initialScrollTop={80}
        onChange={onChange}
      />,
    ),
  );
  expect(container.querySelector(".milkdown-editor")?.scrollTop).toBe(80);
});

test("history preview opens on focus, closes with Escape, and ignores a cancelled read", async () => {
  const item = {
    notePath: "/notes/a.md",
    noteId: "a",
    windowId: "a",
    lastOpenedAt: "2026-01-01",
    matchedByContent: false,
  };
  await act(async () =>
    root.render(
      <HistorySection
        historyQuery=""
        historyLoading={false}
        historyResults={[item]}
        historyTotal={1}
        onDeleted={() => {}}
        historyOpeningPath={null}
        historyError={null}
        setHistoryQuery={() => {}}
        onOpenHistoryItem={async () => {}}
        formatDateTime={(value) => value}
        editorFontFamily="system"
        editorFontSize={14}
        editorLineHeight={1.5}
      />,
    ),
  );
  const itemButton = container.querySelector<HTMLButtonElement>(
    "[data-history-open]",
  );
  if (!itemButton) throw new Error("Missing history item");
  await act(async () => itemButton.focus());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const preview = document.querySelector("aside");
  expect(preview).not.toBeNull();
  expect(itemButton.getAttribute("aria-describedby")).toBe(preview?.id);
  await key(itemButton, "Escape");
  expect(document.querySelector("aside")).toBeNull();
  // A different item avoids the completed read cache.
  const next = { ...item, notePath: "/notes/b.md", noteId: "b" };
  let resolveRead: (value: string) => void = () => {};
  mocks.readTextFile.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  await act(async () => itemButton.blur());
  await act(async () =>
    root.render(
      <HistorySection
        historyQuery=""
        historyLoading={false}
        historyResults={[next]}
        historyTotal={1}
        onDeleted={() => {}}
        historyOpeningPath={null}
        historyError={null}
        setHistoryQuery={() => {}}
        onOpenHistoryItem={async () => {}}
        formatDateTime={(value) => value}
        editorFontFamily="system"
        editorFontSize={14}
        editorLineHeight={1.5}
      />,
    ),
  );
  const nextButton = container.querySelector<HTMLButtonElement>(
    "[data-history-open]",
  );
  if (!nextButton) throw new Error("Missing next history item");
  await act(async () => nextButton.focus());
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await key(nextButton, "Escape");
  await act(async () => resolveRead("Late content"));
  expect(document.querySelector("aside")).toBeNull();
});

test("menu context changes recalculate title overflow even without ResizeObserver", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  try {
    const context: NoteContextMenuContext = {
      targetWindowLabel: "note",
      noteId: "short",
      notePath: "/notes/a.md",
      anchorX: 10,
      anchorY: 20,
      noteOpacity: 1,
      noteReadOnly: false,
      maximized: false,
    };
    await act(async () => root.render(<ContextMenuApp {...context} />));
    const viewport = container.querySelector<HTMLElement>(
      ".pinote-menu-title-viewport",
    );
    const text = container.querySelector<HTMLElement>(
      ".pinote-menu-title-text",
    );
    if (!viewport || !text) throw new Error("Missing menu title");
    Object.defineProperty(viewport, "clientWidth", { value: 50 });
    Object.defineProperty(text, "scrollWidth", {
      get: () => (text.textContent?.length ?? 0) * 10,
    });
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(text.style.getPropertyValue("--pinote-menu-title-distance")).toBe(
      "0px",
    );
    await act(async () =>
      mocks.menuSync?.({ ...context, noteId: "a much longer title" }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(text.style.getPropertyValue("--pinote-menu-title-distance")).toBe(
      "140px",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
