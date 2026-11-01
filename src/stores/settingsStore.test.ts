import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type SettingsSnapshot } from "@/stores/settings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handler: null as null | ((snapshot: SettingsSnapshot) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/logger", () => ({ logInfo: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/settingsEvents", () => ({
  listenSettingsUpdated: mocks.listen,
}));

function snapshot(
  revision: number,
  confirmNoteDeletion = true,
): SettingsSnapshot {
  return { revision, settings: { ...DEFAULT_SETTINGS, confirmNoteDeletion } };
}

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.handler = null;
  mocks.listen.mockImplementation(async (handler) => {
    mocks.handler = handler;
    return vi.fn();
  });
  mocks.invoke.mockResolvedValue(snapshot(0));
});

describe("settings store", () => {
  it("keeps newer events when the initial read or an update returns late", async () => {
    const store = await import("./settingsStore");
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.handler?.(snapshot(2, false));
      return snapshot(1);
    });
    await store.ensureSettingsStoreReady();
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(false);
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.handler?.(snapshot(4));
      return snapshot(3, false);
    });
    await store.updateSettingsStore({ confirmNoteDeletion: false });
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(true);
  });

  it("preserves saved state on failure and allows a later retry", async () => {
    const store = await import("./settingsStore");
    await store.ensureSettingsStoreReady();
    mocks.invoke.mockRejectedValueOnce({
      message: "Could not save settings",
      snapshot: null,
    });
    await expect(
      store.updateSettingsStore({ confirmNoteDeletion: false }),
    ).rejects.toMatchObject({ message: "Could not save settings" });
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(true);
    mocks.invoke.mockResolvedValueOnce(snapshot(1, false));
    await store.updateSettingsStore({ confirmNoteDeletion: false });
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(false);
    expect(mocks.invoke).toHaveBeenLastCalledWith("update_settings", {
      patch: { confirmNoteDeletion: false },
    });
  });

  it("reports synchronization failure while keeping the actual saved value", async () => {
    const store = await import("./settingsStore");
    await store.ensureSettingsStoreReady();
    mocks.invoke.mockRejectedValueOnce({
      message: "Could not synchronize settings",
      snapshot: snapshot(1, false),
    });
    await expect(
      store.updateSettingsStore({ confirmNoteDeletion: false }),
    ).rejects.toMatchObject({ message: "Could not synchronize settings" });
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(false);
  });

  it("submits rapid changes in order without sending stale full settings", async () => {
    const store = await import("./settingsStore");
    await store.ensureSettingsStoreReady();
    let finish!: (value: SettingsSnapshot) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.invoke.mockResolvedValueOnce(snapshot(2));
    const first = store.updateSettingsStore({ confirmNoteDeletion: false });
    const second = store.updateSettingsStore({ confirmNoteDeletion: true });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(true);
    finish(snapshot(1, false));
    await Promise.all([first, second]);
    expect(mocks.invoke).toHaveBeenLastCalledWith("update_settings", {
      patch: { confirmNoteDeletion: true },
    });
    expect(store.getSettingsSnapshot()?.confirmNoteDeletion).toBe(true);
  });
});
