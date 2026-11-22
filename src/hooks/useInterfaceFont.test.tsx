// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/stores/settings";
import { useInterfaceFont } from "./useInterfaceFont";

let settings: Settings = DEFAULT_SETTINGS;
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings }),
}));

function Probe() {
  useInterfaceFont();
  return null;
}

test("the interface follows the note fonts only when switched on", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const style = document.documentElement.style;
  const root = createRoot(document.createElement("div"));
  const render = async (next: Partial<Settings>) => {
    settings = { ...DEFAULT_SETTINGS, ...next };
    await act(async () => root.render(<Probe />));
  };
  const fonts = [
    { family: "Noto Sans SC", enabled: true },
    { family: "Georgia", enabled: false },
  ];
  await render({ editorFontFamily: fonts, editorFontWeight: 300 });
  expect(style.getPropertyValue("--interface-font-family")).toBe("");
  await render({
    editorFontFamily: fonts,
    editorFontWeight: 300,
    interfaceFollowEditorFont: true,
  });
  expect(style.getPropertyValue("--interface-font-family")).toBe(
    '"Noto Sans SC", system-ui, -apple-system, sans-serif',
  );
  expect(style.getPropertyValue("--interface-font-weight")).toBe("300");
  await render({ editorFontFamily: fonts, interfaceFollowEditorFont: false });
  expect(style.getPropertyValue("--interface-font-family")).toBe("");
  expect(style.getPropertyValue("--interface-font-weight")).toBe("");
  await act(async () => root.unmount());
});
