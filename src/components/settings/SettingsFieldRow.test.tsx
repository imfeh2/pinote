// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { SettingsFieldRow } from "./SettingsFieldRow";

test("fields share one row until their content no longer fits", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  let width = 400;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return new DOMRect(0, 0, this.tagName === "INPUT" ? 88 : 30, 20);
    },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <SettingsFieldRow count={3}>
        {["Size", "Weight", "Height"].map((label) => (
          <div key={label}>
            <span>{label}</span>
            <input aria-label={label} />
          </div>
        ))}
      </SettingsFieldRow>,
    ),
  );
  const grid = container.firstElementChild;
  expect(grid?.classList.contains("grid-cols-3")).toBe(true);
  width = 300;
  await act(async () => resize());
  expect(grid?.classList.contains("grid-cols-1")).toBe(true);
  width = 360;
  await act(async () => resize());
  expect(grid?.classList.contains("grid-cols-3")).toBe(true);
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
