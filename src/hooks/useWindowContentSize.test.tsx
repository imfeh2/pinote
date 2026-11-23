// @vitest-environment happy-dom

import type { Window } from "@tauri-apps/api/window";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useWindowContentSize } from "./useWindowContentSize";

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let resized: ((event: { payload: { width: number; height: number } }) => void) | null;
let result: ReturnType<typeof useWindowContentSize> = null;

const appWindow = {
  label: "note",
  innerSize: async () => ({ width: 402, height: 490 }),
  onResized: async (handler: typeof resized) => {
    resized = handler;
    return () => {};
  },
} as unknown as Window;

function Probe() {
  result = useWindowContentSize(appWindow);
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resized = null;
  result = null;
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1.25);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("matches the window content area in CSS pixels", async () => {
  await act(async () => root.render(<Probe />));
  expect(result).toEqual({ width: 321.6, height: 392 });
  await act(async () => resized?.({ payload: { width: 431, height: 345 } }));
  expect(result).toEqual({ width: 344.8, height: 276 });
});
