// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  expect,
  type MockInstance,
  test,
  vi,
} from "vitest";
import App from "@/App";
import { WorkingCopy, type WorkingCopySnapshot } from "@/lib/workingCopy";
import { DEFAULT_SETTINGS } from "@/stores/settings";

const mocks = vi.hoisted(() => ({
  toggle: vi.fn<() => Promise<boolean>>(),
  persist: vi.fn<() => Promise<boolean>>(),
  noop: () => {},
  toggleFromActions: null as (() => Promise<void> | void) | null,
  requestDelete: null as (() => Promise<void>) | null,
  workingCopy: null as WorkingCopy | null,
  updateSettings: vi.fn(),
  refreshSettings: vi.fn(),
  cachedConfirmation: true,
  snapshot: {} as Partial<WorkingCopySnapshot>,
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
  return {
    useSettings: () => ({
      settings: {
        ...DEFAULT_SETTINGS,
        confirmNoteDeletion: mocks.cachedConfirmation,
      },
      updateSettings: mocks.updateSettings,
    }),
  };
});
vi.mock("@/stores/settingsStore", () => ({
  refreshSettingsStore: mocks.refreshSettings,
}));
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
  useWorkingCopy: (workingCopy: WorkingCopy) => {
    mocks.workingCopy = workingCopy;
    return {
      phase: "ready",
      content: "Note",
      external: null,
      error: null,
      reload: 0,
      ...mocks.snapshot,
    };
  },
}));
vi.mock("@/hooks/useNoteWindowMouseInteractions", () => ({
  useNoteWindowMouseInteractions: () => ({ openContextMenu: mocks.noop }),
}));
vi.mock("@/hooks/useNoteWindowActions", () => ({
  useNoteWindowActions: ({
    toggleAlwaysOnTop,
    requestDelete,
  }: {
    toggleAlwaysOnTop: () => Promise<void> | void;
    requestDelete: () => Promise<void>;
  }) => {
    mocks.toggleFromActions = toggleAlwaysOnTop;
    mocks.requestDelete = requestDelete;
    return { startWindowDrag: mocks.noop };
  },
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/windowApi", () => ({
  bringNoteWindowsBackOnScreen: async () => {},
  getRuntimePlatform: async () => "other",
}));

beforeEach(() => {
  mocks.cachedConfirmation = true;
  mocks.snapshot = {};
  mocks.updateSettings.mockReset().mockResolvedValue(undefined);
  mocks.refreshSettings.mockReset().mockResolvedValue(DEFAULT_SETTINGS);
});
afterEach(() => vi.restoreAllMocks());

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

async function withNote(
  check: (end: MockInstance<WorkingCopy["end"]>) => Promise<void>,
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const initial = new WorkingCopy().getSnapshot();
  const end = vi
    .spyOn(WorkingCopy.prototype, "end")
    .mockResolvedValue({ ended: true, version: null, error: null });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<App noteId="note" notePath="/notes/note.md" />),
    );
    if (!mocks.workingCopy) throw new Error("Missing working copy");
    vi.spyOn(mocks.workingCopy, "getSnapshot").mockReturnValue({
      ...initial,
      phase: "ready",
      content: "Note",
    });
    await check(end);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

function dialogButton(label: string) {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
  ).find((button) => button.textContent === label);
  if (!button) throw new Error(`Missing dialog button: ${label}`);
  return button;
}

function confirmationCheckbox() {
  const checkbox = document.querySelector<HTMLButtonElement>(
    '[role="alertdialog"] [role="checkbox"]',
  );
  if (!checkbox) throw new Error("Missing confirmation checkbox");
  return checkbox;
}

test("confirmation checkbox and label share a pointer target without deleting", async () => {
  await withNote(async (end) => {
    await act(async () => mocks.requestDelete?.());
    const checkbox = confirmationCheckbox();
    const label = checkbox.closest("label");
    if (!label) throw new Error("Missing confirmation label");
    expect(label.htmlFor).toBe(checkbox.id);
    expect(label.classList.contains("cursor-pointer")).toBe(true);
    expect(checkbox.classList.contains("cursor-pointer")).toBe(true);
    expect(checkbox.classList.contains("disabled:cursor-not-allowed")).toBe(
      true,
    );
    expect(label.classList.contains("has-disabled:cursor-not-allowed")).toBe(
      true,
    );
    await act(async () => label.click());
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    await act(async () => checkbox.click());
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(end).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

test("cancel does not save the choice, and a new confirmation starts unchecked", async () => {
  await withNote(async (end) => {
    await act(async () => {
      await mocks.requestDelete?.();
    });
    expect(confirmationCheckbox().getAttribute("aria-checked")).toBe("false");
    await act(async () => confirmationCheckbox().click());
    await act(async () => dialogButton("actions.cancel").click());
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    await act(async () => {
      await mocks.requestDelete?.();
    });
    expect(confirmationCheckbox().getAttribute("aria-checked")).toBe("false");
    await act(async () => dialogButton("deletion.confirm").click());
    expect(end).toHaveBeenCalledWith("delete");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

test("remembering the choice waits for saving before deleting and blocks dismissal", async () => {
  await withNote(async (end) => {
    let finish!: () => void;
    mocks.updateSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      await mocks.requestDelete?.();
    });
    await act(async () => confirmationCheckbox().click());
    await act(async () => dialogButton("deletion.confirm").click());
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      confirmNoteDeletion: false,
    });
    expect(end).not.toHaveBeenCalled();
    expect(dialogButton("actions.cancel").disabled).toBe(true);
    expect(confirmationCheckbox().disabled).toBe(true);
    await act(async () => {
      document.querySelector('[role="alertdialog"]')?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => finish());
    expect(end).toHaveBeenCalledOnce();
  });
});

test("saving failure keeps the note and confirmation available for retry", async () => {
  await withNote(async (end) => {
    mocks.updateSettings.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      await mocks.requestDelete?.();
    });
    await act(async () => confirmationCheckbox().click());
    await act(async () => dialogButton("deletion.confirm").click());
    expect(end).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Editor");
    expect(document.body.textContent).toContain("deletion.preferencesFailed");
    expect(dialogButton("actions.cancel").disabled).toBe(false);
    await act(async () => dialogButton("deletion.confirm").click());
    expect(end).toHaveBeenCalledOnce();
  });
});

test("uses the current shared preference even when the local render still has confirmation enabled", async () => {
  await withNote(async (end) => {
    mocks.refreshSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      confirmNoteDeletion: false,
    });
    await act(async () => {
      await mocks.requestDelete?.();
    });
    expect(end).toHaveBeenCalledWith("delete");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

test("direct deletion failures still display an error and retry action", async () => {
  await withNote(async (end) => {
    mocks.refreshSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      confirmNoteDeletion: false,
    });
    end.mockResolvedValue({
      ended: false,
      version: null,
      error: { kind: "io", message: "Access denied" },
    });
    await act(async () => {
      await mocks.requestDelete?.();
    });
    expect(document.body.textContent).toContain("deletion.failed");
    expect(document.body.textContent).toContain("Access denied");
    expect(dialogButton("actions.retry").disabled).toBe(false);
  });
});

test("a confirmation restored in another window overrides the stale local preference", async () => {
  mocks.cachedConfirmation = false;
  await withNote(async (end) => {
    await act(async () => {
      await mocks.requestDelete?.();
    });
    expect(end).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});

test("ending a note during preference saving prevents a late delete request", async () => {
  await withNote(async (end) => {
    let finish!: () => void;
    mocks.updateSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      await mocks.requestDelete?.();
    });
    await act(async () => confirmationCheckbox().click());
    await act(async () => dialogButton("deletion.confirm").click());
    const workingCopy = mocks.workingCopy;
    if (!workingCopy) throw new Error("Missing working copy");
    vi.mocked(workingCopy.getSnapshot).mockReturnValue({
      ...workingCopy.getSnapshot(),
      phase: "ended",
    });
    await act(async () => finish());
    expect(end).not.toHaveBeenCalled();
  });
});

test("a failed preference read never deletes without confirmation", async () => {
  await withNote(async (end) => {
    mocks.refreshSettings.mockRejectedValueOnce(new Error("Unavailable"));
    await act(async () => {
      await mocks.requestDelete?.();
    });
    expect(end).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "deletion.preferencesUnavailable",
    );
  });
});

test("note problems open a dialog that stays closed after cancel", async () => {
  mocks.snapshot = { phase: "ended", error: { kind: "missing" } };
  await withNote(async () => {
    const dialog = () => document.querySelector('[role="alertdialog"]');
    expect(dialog()?.textContent).toContain("errors.missing");
    expect(() => dialogButton("actions.retry")).toThrow();
    expect(dialogButton("actions.close").disabled).toBe(false);
    await act(async () => dialogButton("actions.cancel").click());
    expect(dialog()).toBeNull();
    await act(async () => mocks.toggleFromActions?.());
    expect(dialog()).toBeNull();
  });
});

test("save errors offer retry and cancel clears the error", async () => {
  mocks.snapshot = { error: { kind: "io", message: "Access denied" } };
  await withNote(async () => {
    expect(document.body.textContent).toContain("Access denied");
    expect(dialogButton("actions.retry").disabled).toBe(false);
    if (!mocks.workingCopy) throw new Error("Missing working copy");
    const dismiss = vi.spyOn(mocks.workingCopy, "dismissError");
    await act(async () => dialogButton("actions.cancel").click());
    expect(dismiss).toHaveBeenCalledOnce();
  });
});

test("problems without loaded content keep the dialog open", async () => {
  mocks.snapshot = {
    content: null,
    error: { kind: "io", message: "Access denied" },
  };
  await withNote(async () => {
    const dialog = () => document.querySelector('[role="alertdialog"]');
    expect(() => dialogButton("actions.cancel")).toThrow();
    await act(async () => {
      dialog()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialog()?.textContent).toContain("Access denied");
    expect(dialogButton("actions.retry").disabled).toBe(false);
  });
});

test("an external change hides other problems until it is resolved", async () => {
  mocks.snapshot = {
    error: { kind: "io", message: "Access denied" },
    external: { content: "Other", version: "v2" },
  };
  await withNote(async () => {
    const dialogs = document.querySelectorAll('[role="alertdialog"]');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].textContent).toContain("externalChange.message");
  });
});

test("external changes require choosing which version to keep", async () => {
  mocks.snapshot = {
    error: { kind: "conflict", snapshot: { content: "Other", version: "v2" } },
    external: { content: "Other", version: "v2" },
  };
  await withNote(async () => {
    const dialog = () => document.querySelector('[role="alertdialog"]');
    expect(dialog()?.textContent).toContain("externalChange.message");
    expect(() => dialogButton("actions.cancel")).toThrow();
    await act(async () => {
      dialog()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialog()).not.toBeNull();
    if (!mocks.workingCopy) throw new Error("Missing working copy");
    const keep = vi
      .spyOn(mocks.workingCopy, "keepCurrent")
      .mockResolvedValue(undefined);
    await act(async () => dialogButton("externalChange.ignore").click());
    expect(keep).toHaveBeenCalledOnce();
  });
});
