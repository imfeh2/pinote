import { expect, test, vi } from "vitest";
import { setNoteWindowsSkipTaskbar } from "./windowApi";

const mocks = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getAll: mocks.getAll },
}));

test("taskbar updates finish every note window before reporting a failure", async () => {
  let finish!: () => void;
  const slow = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const other = vi.fn();
  mocks.getAll.mockResolvedValue([
    {
      label: "note-a",
      setSkipTaskbar: async () => {
        throw new Error("Access denied");
      },
    },
    { label: "note-b", setSkipTaskbar: slow },
    { label: "note-a-context-menu", setSkipTaskbar: other },
    { label: "settings", setSkipTaskbar: other },
  ]);
  let settled = false;
  const update = setNoteWindowsSkipTaskbar(false);
  const observed = update.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce());
  expect(settled).toBe(false);
  finish();
  await expect(update).rejects.toThrow("Access denied");
  await observed;
  expect(slow).toHaveBeenCalledWith(false);
  expect(other).not.toHaveBeenCalled();
});
