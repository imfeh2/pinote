// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import App from "@/App";

const mocks = vi.hoisted(() => ({
  toggle: vi.fn<() => Promise<boolean>>(),
  persist: vi.fn<() => Promise<boolean>>(),
  noop: () => {},
  toggleFromActions: null as (() => Promise<void> | void) | null,
}));

vi.mock("@tauri-apps/api/window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/window")>()),
  getCurrentWindow: () => ({
    label: "note",
    listen: async () => mocks.noop,
    onScaleChanged: async () => mocks.noop,
    clearEffects: async () => {},
  }),
}));
vi.mock("@/components/Editor", () => ({ Editor: () => <div>Editor</div> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ toggleTheme: mocks.noop }),
}));
vi.mock("@/hooks/useSettings", async () => {
  const { DEFAULT_SETTINGS } = await import("@/stores/settings");
  return { useSettings: () => ({ settings: DEFAULT_SETTINGS }) };
});
vi.mock("@/hooks/useWindowControl", () => ({
  useWindowControl: () => ({
    alwaysOnTop: false,
    toggleAlwaysOnTop: mocks.toggle,
  }),
}));
vi.mock("@/hooks/useNoteWindowState", () => ({
  useNoteWindowState: () => ({
    hideWindow: mocks.noop,
    handleScrollTopChange: mocks.noop,
    initialEditorScrollTop: 0,
    persistWindowState: mocks.persist,
    setInitialEditorScrollTop: mocks.noop,
  }),
}));
vi.mock("@/hooks/useWorkingCopy", () => ({
  useWorkingCopy: () => ({
    phase: "ready",
    content: "Note",
    external: null,
    error: null,
    reload: 0,
  }),
}));
vi.mock("@/hooks/useNoteWindowMouseInteractions", () => ({
  useNoteWindowMouseInteractions: () => ({ openContextMenu: mocks.noop }),
}));
vi.mock("@/hooks/useNoteWindowActions", () => ({
  useNoteWindowActions: ({
    toggleAlwaysOnTop,
  }: {
    toggleAlwaysOnTop: () => Promise<void> | void;
  }) => {
    mocks.toggleFromActions = toggleAlwaysOnTop;
    return { startWindowDrag: mocks.noop };
  },
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/windowApi", () => ({
  bringNoteWindowsBackOnScreen: async () => {},
  getRuntimePlatform: async () => "other",
}));

test("pin changes persist only after the native action succeeds", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finishToggle: () => void = mocks.noop;
  mocks.toggle.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishToggle = () => resolve(true);
      }),
  );
  mocks.persist.mockResolvedValue(true);
  try {
    await act(async () =>
      root.render(<App noteId="note" notePath="/notes/note.md" />),
    );
    const toggle = mocks.toggleFromActions;
    if (!toggle) throw new Error("Missing pin action");
    await act(async () => {
      const pending = toggle();
      expect(mocks.persist).not.toHaveBeenCalled();
      finishToggle();
      await pending;
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
    mocks.persist.mockClear();
    mocks.toggle.mockResolvedValue(false);
    await act(async () => mocks.toggleFromActions?.());
    expect(mocks.persist).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
