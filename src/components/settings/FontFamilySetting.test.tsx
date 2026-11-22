// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EditorFont } from "@/stores/settings";
import { FontFamilySetting } from "./FontFamilySetting";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

vi.mock("@/lib/fonts", () => ({
  listFontFamilies: async () => ["Consolas", "Georgia", "LXGW WenKai"],
}));

const change = vi.fn(async (_families: EditorFont[]) => {});
const on = (family: string) => ({ family, enabled: true });
let container: HTMLDivElement;
let root: Root;

async function render(families: EditorFont[]) {
  await act(async () =>
    root.render(
      <FontFamilySetting
        families={families}
        fontSize={15}
        lineHeight={1.2}
        fontWeight={400}
        onChange={change}
      />,
    ),
  );
}

function button(label: string) {
  const element = document.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`,
  );
  if (!element) throw new Error(`Missing ${label}`);
  return element;
}

function rows() {
  return Array.from(container.querySelectorAll("li"));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  change.mockClear();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("cmdk-list") ? 240 : 28;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(28);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  vi.unstubAllGlobals();
});

test("adds a font and marks the fonts already in the list", async () => {
  await render([on("Georgia")]);
  const add = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === "appearance.typography.addFont",
  );
  if (!add) throw new Error("Missing add button");
  await act(async () => add.click());
  const options = Array.from(document.querySelectorAll('[role="option"]'));
  expect(
    options.map((option) => [
      option.textContent,
      option.getAttribute("aria-disabled"),
    ]),
  ).toEqual([
    ["Consolas", "false"],
    ["Georgia", "true"],
    ["LXGW WenKai", "false"],
  ]);
  await act(async () => (options[1] as HTMLElement).click());
  expect(change).not.toHaveBeenCalled();
  await act(async () => (options[2] as HTMLElement).click());
  expect(change).toHaveBeenCalledWith([on("Georgia"), on("LXGW WenKai")]);
});

test("removes a font", async () => {
  await render([on("Georgia"), on("Consolas")]);
  await act(async () =>
    button("appearance.typography.removeFont:Georgia").click(),
  );
  expect(change).toHaveBeenCalledWith([on("Consolas")]);
});

test("turns a font off without removing it", async () => {
  await render([on("Georgia"), on("Consolas")]);
  await act(async () =>
    button("appearance.typography.useFont:Georgia").click(),
  );
  expect(change).toHaveBeenCalledWith([
    { family: "Georgia", enabled: false },
    on("Consolas"),
  ]);
});

test("the keyboard moves a font to a new place", async () => {
  await render([on("Georgia"), on("Consolas")]);
  const handle = button("appearance.typography.reorderFont:Georgia");
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
  expect(change).toHaveBeenCalledWith([on("Consolas"), on("Georgia")]);
});

test("the preview can be edited", async () => {
  await render([]);
  const content = container.querySelector(".cm-content");
  expect(content?.getAttribute("contenteditable")).toBe("true");
});
