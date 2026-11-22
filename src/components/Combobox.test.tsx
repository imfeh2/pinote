// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Combobox } from "./Combobox";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.hasAttribute("cmdk-list")) return new DOMRect(0, 0, 200, 240);
      return new DOMRect(0, 0, 200, 28);
    },
  );
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(options: string[], value?: string) {
  await act(async () =>
    root.render(
      <Combobox
        options={options}
        value={value}
        checked={value ? [value, options[0]] : []}
        label="Fonts"
        searchPlaceholder="Search"
        emptyText="None"
        optionStyle={(option) => ({ fontFamily: option })}
        onSelect={() => {}}
      >
        <button type="button">Open</button>
      </Combobox>,
    ),
  );
  await act(async () => container.querySelector("button")?.click());
}

async function type(text: string) {
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
  if (!input) throw new Error("Missing search input");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function shown() {
  return Array.from(document.querySelectorAll('[role="option"]')).map(
    (option) => option.textContent,
  );
}

test("search keeps the original order and restores it when cleared", async () => {
  await open(["Arial", "Consolas", "Georgia", "Segoe UI"]);
  await type("o");
  expect(shown()).toEqual(["Consolas", "Georgia", "Segoe UI"]);
  await type("SEGOE");
  expect(shown()).toEqual(["Segoe UI"]);
  await type("zzz");
  expect(shown()).toEqual([]);
  expect(document.body.textContent).toContain("None");
  await type("");
  expect(shown()).toEqual(["Arial", "Consolas", "Georgia", "Segoe UI"]);
});

test("only rows near the visible part are created, each in its own font", async () => {
  const fonts = Array.from({ length: 200 }, (_, index) => `Font ${index}`);
  await open(fonts);
  const labels = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"] span'),
  );
  expect(labels.length).toBeGreaterThan(8);
  expect(labels.length).toBeLessThan(40);
  for (const label of labels) {
    expect(label.style.fontFamily.replace(/"/g, "")).toBe(label.textContent);
  }
});

test("opening with a value shows that option selected in the middle of the list", async () => {
  const fonts = Array.from({ length: 200 }, (_, index) => `Font ${index}`);
  await open(fonts, "Font 120");
  const list = document.querySelector<HTMLElement>("[cmdk-list]");
  expect(list?.scrollTop).toBe(4 + 120 * 28 - (240 - 28) / 2);
  const selected = document.querySelector(
    '[role="option"][aria-selected="true"]',
  );
  expect(selected?.textContent).toBe("Font 120");
  expect(selected?.getAttribute("aria-disabled")).toBe("false");
  const first = shown();
  expect(first).toContain("Font 120");
  expect(first).not.toContain("Font 0");
});
