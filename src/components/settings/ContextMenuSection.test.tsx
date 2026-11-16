// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/stores/settings";
import { ContextMenuSection } from "./ContextMenuSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

const update = vi.fn(async () => {});
let container: HTMLDivElement;
let root: Root;

async function render(settings: Partial<Settings> = {}) {
  await act(async () =>
    root.render(
      <ContextMenuSection
        settings={{ ...DEFAULT_SETTINGS, ...settings }}
        updateSettings={update}
      />,
    ),
  );
}

function rows() {
  return Array.from(container.querySelectorAll("li"));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  update.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const row = this.closest("li");
      const index = row ? rows().indexOf(row) : 0;
      return new DOMRect(0, index * 30, 200, 30);
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("switches show or hide one menu item", async () => {
  await render();
  const theme = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="contextMenu.items.toggle-theme"]',
  );
  if (!theme) throw new Error("Missing theme switch");
  expect(theme.getAttribute("aria-checked")).toBe("false");
  await act(async () => theme.click());
  expect(update).toHaveBeenCalledWith({
    contextMenuItems: DEFAULT_SETTINGS.contextMenuItems.map((item) =>
      item.action === "toggle-theme" ? { ...item, visible: true } : item,
    ),
  });
});

test("the keyboard moves a menu item to a new place", async () => {
  await render();
  const [first, second, ...rest] = DEFAULT_SETTINGS.contextMenuItems;
  const handle = container.querySelector<HTMLButtonElement>(
    `[aria-label="contextMenu.reorder:contextMenu.items.${first.action}"]`,
  );
  if (!handle) throw new Error("Missing drag handle");
  const press = async (code: string) => {
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await act(async () => handle.focus());
  await press("Space");
  await press("ArrowDown");
  await press("Space");
  expect(update).toHaveBeenCalledWith({
    contextMenuItems: [second, first, ...rest],
  });
});

test("minimize explains when it stays out of the menu", async () => {
  const note = '[aria-label="contextMenu.minimizeHidden"]';
  await render({ hideNoteWindowsFromTaskbar: true });
  expect(container.querySelector(note)).not.toBeNull();
  await render({ hideNoteWindowsFromTaskbar: false });
  expect(container.querySelector(note)).toBeNull();
});
