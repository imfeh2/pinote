// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTheme } from "@/hooks/useTheme";
import { DEFAULT_SETTINGS, type Settings } from "@/stores/settings";
import { SettingsSwitch } from "./SettingsSwitch";

const mocks = vi.hoisted(() => ({ settings: {} as Settings, update: vi.fn() }));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.update,
  }),
}));
vi.mock("@tauri-apps/api/app", () => ({ setTheme: async () => {} }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.settings = { ...DEFAULT_SETTINGS, theme: "light" };
  mocks.update.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("consecutive switches retain intent across delayed saved values", async () => {
  const pending: (() => void)[] = [];
  const update = vi.fn(
    (_checked: boolean) =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  );
  const render = (checked: boolean) =>
    root.render(
      <SettingsSwitch
        checked={checked}
        label="Follow opacity"
        onCheckedChange={update}
      />,
    );
  await act(async () => render(false));
  const toggle = container.querySelector("button");
  if (!toggle) throw new Error("Missing switch");
  await act(async () => {
    toggle.click();
    toggle.click();
  });
  expect(update.mock.calls).toEqual([[true], [false]]);
  await act(async () => {
    pending[0]();
    render(true);
  });
  await act(async () => toggle.click());
  expect(update.mock.calls).toEqual([[true], [false], [true]]);
  await act(async () => {
    pending[1]();
    render(false);
  });
  await act(async () => {
    pending[2]();
    render(true);
  });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

test("consecutive theme actions use the latest requested theme", async () => {
  const pending: (() => void)[] = [];
  mocks.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  );
  let toggle = () => {};
  function ThemeConsumer() {
    toggle = useTheme().toggleTheme;
    return null;
  }
  await act(async () => root.render(<ThemeConsumer />));
  await act(async () => {
    toggle();
    toggle();
  });
  expect(mocks.update.mock.calls).toEqual([
    [{ theme: "dark" }],
    [{ theme: "light" }],
  ]);
  await act(async () => {
    pending[0]();
    mocks.settings = { ...mocks.settings, theme: "dark" };
    root.render(<ThemeConsumer />);
  });
  await act(async () => toggle());
  expect(mocks.update).toHaveBeenLastCalledWith({ theme: "dark" });
  await act(async () => {
    pending[1]();
    pending[2]();
  });
});
