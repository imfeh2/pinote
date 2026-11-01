// @vitest-environment happy-dom

import { createInstance } from "i18next";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import settingsZh from "@/i18n/resources/zh-CN/settings";
import { SettingsApp } from "@/SettingsApp";
import { DEFAULT_SETTINGS, type Settings } from "@/stores/settings";

const mocks = vi.hoisted(() => ({
  settings: {} as Settings,
  update: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  contextMenu: vi.fn(),
  defaultOpen: vi.fn(),
  taskbar: vi.fn(),
  dataExport: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.update,
  }),
}));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({}) }));
vi.mock("@/lib/dataExport", () => ({ exportAppData: mocks.dataExport }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.6.3" }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => false,
  enable: mocks.enable,
  disable: mocks.disable,
}));
vi.mock("@/lib/notes", () => ({
  resolveDefaultNotesDirectory: async () => "/notes",
}));
vi.mock("@/lib/windowApi", () => ({
  getDefaultMarkdownOpenEnabled: async () => false,
  getOpenWithPinoteEnabled: async () => false,
  getRuntimePlatform: async () => "other",
  setOpenWithPinoteEnabled: mocks.contextMenu,
  setDefaultMarkdownOpenEnabled: mocks.defaultOpen,
  setNoteWindowsSkipTaskbar: mocks.taskbar,
  setGlobalShortcuts: async () => ({
    newNote: true,
    restoreWindow: true,
    showAllHiddenWindows: true,
    toggleVisibleWindows: true,
  }),
}));
vi.mock("@/lib/updater", () => ({
  getUpdateState: () => ({ state: "idle", available: false }),
  subscribeUpdateState: () => () => {},
  checkForUpdates: async () => ({}),
}));

let container: HTMLDivElement;
let root: Root;
let i18n: ReturnType<typeof createInstance>;
const render = () =>
  root.render(
    <I18nextProvider i18n={i18n}>
      <SettingsApp />
    </I18nextProvider>,
  );

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.settings = { ...DEFAULT_SETTINGS };
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.enable.mockReset().mockResolvedValue(undefined);
  mocks.disable.mockReset().mockResolvedValue(undefined);
  mocks.contextMenu.mockReset().mockImplementation(async (enabled) => enabled);
  mocks.defaultOpen.mockReset().mockImplementation(async (enabled) => enabled);
  mocks.taskbar.mockReset().mockResolvedValue(undefined);
  mocks.dataExport.mockReset().mockResolvedValue(null);
  i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { settings: settingsZh } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => render());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function getSwitch(label: string) {
  const element = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
  ).find((button) => button.getAttribute("aria-label") === label);
  if (!element) throw new Error(`Missing switch: ${label}`);
  return element;
}

async function selectPage(label: string) {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("aside button"),
  ).find((button) => button.textContent === label);
  if (!button) throw new Error(`Missing page: ${label}`);
  await act(async () => button.click());
  expect(button.getAttribute("aria-current")).toBe("page");
}

test("preferences navigation exposes a persistent confirmation switch and preserves its value on failure", async () => {
  await selectPage("偏好");
  const toggle = () => getSwitch("删除前确认");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  let finish!: () => void;
  mocks.update.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => toggle().click());
  expect(mocks.update).toHaveBeenCalledWith({ confirmNoteDeletion: false });
  expect(toggle().disabled).toBe(true);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => {
    mocks.settings = { ...mocks.settings, confirmNoteDeletion: false };
    finish();
    render();
  });
  expect(toggle().disabled).toBe(false);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  mocks.update.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => toggle().click());
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "未能更新设置，请重试。",
  );
  mocks.update.mockImplementationOnce(async () => {
    mocks.settings = { ...mocks.settings, confirmNoteDeletion: true };
  });
  await act(async () => toggle().click());
  await act(async () => render());
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("system switches reflect native results without depending on settings file writes", async () => {
  mocks.update.mockRejectedValue(new Error("disk full"));
  await selectPage("窗口");
  for (const label of [
    "开机时打开 Pinote",
    "添加“使用 Pinote 打开”",
    "Markdown 默认应用",
  ]) {
    expect(getSwitch(label).getAttribute("aria-checked")).toBe("false");
    await act(async () => getSwitch(label).click());
    expect(getSwitch(label).getAttribute("aria-checked")).toBe("true");
    await act(async () => getSwitch(label).click());
    expect(getSwitch(label).getAttribute("aria-checked")).toBe("false");
  }
  expect(mocks.enable).toHaveBeenCalledOnce();
  expect(mocks.disable).toHaveBeenCalledOnce();
  expect(mocks.contextMenu.mock.calls).toEqual([[true], [false]]);
  expect(mocks.defaultOpen.mock.calls).toEqual([[true], [false]]);
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.enable.mockRejectedValueOnce(new Error("Access denied"));
  await act(async () => getSwitch("开机时打开 Pinote").click());
  expect(getSwitch("开机时打开 Pinote").getAttribute("aria-checked")).toBe(
    "false",
  );
  expect(container.textContent).toContain(settingsZh.errors.unknown);
});

test("taskbar behavior changes only after its preference is saved", async () => {
  await selectPage("窗口");
  mocks.update.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => getSwitch("在任务栏中隐藏便签").click());
  expect(mocks.taskbar).not.toHaveBeenCalled();
  expect(getSwitch("在任务栏中隐藏便签").getAttribute("aria-checked")).toBe(
    "true",
  );
  let finish!: () => void;
  mocks.update.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => getSwitch("在任务栏中隐藏便签").click());
  expect(mocks.taskbar).not.toHaveBeenCalled();
  expect(getSwitch("在任务栏中隐藏便签").disabled).toBe(true);
  await act(async () => {
    mocks.settings = { ...mocks.settings, hideNoteWindowsFromTaskbar: false };
    finish();
    render();
  });
  expect(mocks.taskbar).toHaveBeenCalledWith(false);
  expect(getSwitch("在任务栏中隐藏便签").getAttribute("aria-checked")).toBe(
    "false",
  );
});

test("data export handles cancellation, busy state, duplicate clicks, failure and retry", async () => {
  await selectPage("关于");
  const button = () => {
    const result = Array.from(
      container.querySelectorAll<HTMLButtonElement>("main button"),
    ).find(
      (item) =>
        item.textContent === settingsZh.dataExport.export ||
        item.textContent === settingsZh.dataExport.exporting,
    );
    if (!result) throw new Error("Missing export action");
    return result;
  };
  await act(async () => button().click());
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  let finish!: (value: unknown) => void;
  mocks.dataExport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    button().click();
    button().click();
  });
  expect(mocks.dataExport).toHaveBeenCalledTimes(2);
  expect(button().disabled).toBe(true);
  await act(async () => finish({ fileCount: 3 }));
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "已导出，共 3 个文件。",
  );
  expect(button().disabled).toBe(false);
  mocks.dataExport.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => button().click());
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    settingsZh.dataExport.failed,
  );
  expect(button().disabled).toBe(false);
  mocks.dataExport.mockResolvedValueOnce({ fileCount: 0 });
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "已导出，共 0 个文件。",
  );
});

test("taskbar application failure is explicit and retry reapplies the saved target", async () => {
  await selectPage("窗口");
  mocks.update.mockImplementation(async (patch) => {
    mocks.settings = { ...mocks.settings, ...patch };
  });
  mocks.taskbar.mockRejectedValueOnce(new Error("Access denied"));
  await act(async () => getSwitch("在任务栏中隐藏便签").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    settingsZh.window.taskbar.applyFailed,
  );
  expect(mocks.settings.hideNoteWindowsFromTaskbar).toBe(false);
  const retry = container.querySelector<HTMLButtonElement>(
    '[role="alert"] button',
  );
  if (!retry) throw new Error("Missing retry action");
  await act(async () => retry.click());
  expect(mocks.taskbar.mock.calls).toEqual([[false], [false]]);
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
