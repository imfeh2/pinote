// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HistorySection } from "./HistorySection";

const mocks = vi.hoisted(() => ({
  deleteNotes: vi.fn(),
  open: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("@/lib/noteHistory", () => ({ deleteHistoryNotes: mocks.deleteNotes }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: async () => "" }));
vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const { default: settings } = await import("@/i18n/resources/en-US/settings");
  const i18n = createInstance();
  await i18n.init({
    lng: "en-US",
    defaultNS: "settings",
    resources: { "en-US": { settings } },
  });
  return { useTranslation: () => ({ t: i18n.t }) };
});
vi.mock("@milkdown/react", () => ({
  useEditor: () => {},
  Milkdown: () => null,
  MilkdownProvider: ({ children }: { children: ReactNode }) => children,
}));

let container: HTMLDivElement;
let root: Root;
let hitTarget: Element | null;

function notes(count: number, prefix = "note") {
  return Array.from({ length: count }, (_, index) => ({
    notePath: `/notes/${prefix}-${index}.md`,
    noteId: `${prefix}-${index}`,
    windowId: `${prefix}-${index}`,
    lastOpenedAt: "2026-01-01",
    matchedByContent: false,
  }));
}

async function render(results = notes(3), query = "") {
  await act(async () =>
    root.render(
      <HistorySection
        historyQuery={query}
        historyLoading={false}
        historyResults={results}
        historyOpeningPath={null}
        historyError={null}
        setHistoryQuery={() => {}}
        onOpenHistoryItem={mocks.open}
        onDeleted={mocks.deleted}
        formatDateTime={(value) => value}
        editorFontFamily="system"
        editorFontSize={14}
        editorLineHeight={1.5}
      />,
    ),
  );
}
function element(selector: string, scope: ParentNode = container) {
  const node = scope.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
async function pointer(node: HTMLElement, type: string, x = 15, y = 25) {
  hitTarget = node;
  await act(async () =>
    node.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    ),
  );
}
function checked(index: number) {
  return element(`[data-history-index="${index}"]`).getAttribute(
    "aria-checked",
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  hitTarget = null;
  vi.spyOn(document, "elementFromPoint").mockImplementation(() => hitTarget);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  mocks.deleteNotes.mockResolvedValue({ deleted: [], failures: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("loads more rows on scroll and selects all matching results including unloaded ones", async () => {
  const results = notes(120);
  await render(results);
  expect(container.querySelectorAll("[data-history-open]")).toHaveLength(40);
  const list = element('[aria-label="History"]');
  Object.defineProperties(list, {
    clientHeight: { value: 400 },
    scrollHeight: {
      get: () => container.querySelectorAll("[data-history-open]").length * 25,
    },
  });
  list.scrollTop = 520;
  await act(async () =>
    list.dispatchEvent(new Event("scroll", { bubbles: true })),
  );
  expect(container.querySelectorAll("[data-history-open]")).toHaveLength(80);
  await click(element('[aria-label="Select all results"]'));
  expect(container.textContent).toContain("120 selected");
  await render(notes(1, "other"), "other");
  expect(container.textContent).toContain("120 outside results");
  await click(element('[data-history-index="0"]'));
  expect(container.textContent).toContain("121 selected");
  await render(results);
  expect(checked(0)).toBe("true");
  await click(element('[aria-label="Select all results"]'));
  expect(container.textContent).toContain("1 selected");
  await click(element('[aria-label="Clear selection"]'));
  expect(checked(0)).toBe("false");
});

test("drag uses the starting checkbox state, fills skipped rows, and never reverses on revisit", async () => {
  await render(notes(5));
  await click(element('[data-history-index="2"]'));
  await pointer(element('[data-history-index="0"]'), "pointerdown");
  await pointer(element('[data-history-index="3"]'), "pointermove");
  await pointer(element('[data-history-index="1"]'), "pointermove");
  expect([0, 1, 2, 3].map(checked)).toEqual(["true", "true", "true", "true"]);
  await pointer(element('[data-history-index="1"]'), "pointerup");
  await pointer(element('[data-history-index="3"]'), "pointerdown");
  await pointer(element('[data-history-index="0"]'), "pointermove");
  await pointer(element('[data-history-index="2"]'), "pointermove");
  await pointer(element('[data-history-index="2"]'), "pointerup");
  expect([0, 1, 2, 3, 4].map(checked)).toEqual([
    "false",
    "false",
    "false",
    "false",
    "false",
  ]);
  expect(mocks.open).not.toHaveBeenCalled();
});

test("suppresses the mouse click following a selection gesture while keeping keyboard and touch clicks", async () => {
  await render();
  const checkbox = element('[data-history-index="0"]');
  await pointer(checkbox, "pointerdown");
  await pointer(checkbox, "pointerup");
  await act(async () =>
    checkbox.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    ),
  );
  expect(checked(0)).toBe("true");
  await click(checkbox);
  expect(checked(0)).toBe("false");
  await act(async () => {
    checkbox.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerType: "touch",
        button: 0,
      }),
    );
    checkbox.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
  expect(checked(0)).toBe("true");
});

test("auto-scrolls at the checkbox edge and stops after releasing the pointer", async () => {
  await render(notes(50));
  const list = element('[aria-label="History"]');
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 300, 200),
  );
  await pointer(element('[data-history-index="0"]'), "pointerdown", 15, 190);
  await pointer(list, "pointermove", 15, 210);
  hitTarget = element('[data-history-index="10"]');
  await act(async () => vi.advanceTimersByTimeAsync(64));
  expect(list.scrollTop).toBeGreaterThan(0);
  expect(document.elementFromPoint).toHaveBeenLastCalledWith(15, 198);
  expect(checked(10)).toBe("true");
  await pointer(list, "pointerup");
  const position = list.scrollTop;
  await act(async () => vi.advanceTimersByTimeAsync(64));
  expect(list.scrollTop).toBe(position);
});

test("confirms all selected paths across searches and displays partial failures in one dialog", async () => {
  const first = notes(1, "first");
  const second = notes(1, "second");
  await render(first);
  await click(element('[data-history-index="0"]'));
  await render(second, "second");
  await click(element('[data-history-index="0"]'));
  await click(element('[aria-label="Delete"]'));
  let dialog = element('[role="alertdialog"]', document);
  expect(dialog.textContent).toContain(first[0].notePath);
  expect(dialog.textContent).toContain(second[0].notePath);
  expect(mocks.deleteNotes).not.toHaveBeenCalled();
  await click(
    Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    ) as HTMLElement,
  );
  expect(mocks.deleteNotes).not.toHaveBeenCalled();
  await click(element('[aria-label="Delete"]'));
  mocks.deleteNotes.mockResolvedValue({
    deleted: [first[0].notePath],
    failures: [{ notePath: second[0].notePath, reason: "Permission denied" }],
  });
  dialog = element('[role="alertdialog"]', document);
  await click(
    Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete",
    ) as HTMLElement,
  );
  expect(mocks.deleteNotes).toHaveBeenCalledWith([
    first[0].notePath,
    second[0].notePath,
  ]);
  expect(mocks.deleted).toHaveBeenCalledWith([first[0].notePath]);
  dialog = element('[role="alertdialog"]', document);
  expect(dialog.textContent).toContain("Permission denied");
  expect(dialog.textContent).toContain(second[0].notePath);
  expect(container.textContent).toContain("1 selected");
  expect(checked(0)).toBe("true");
});
