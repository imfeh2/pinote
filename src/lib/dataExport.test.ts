import { beforeEach, expect, test, vi } from "vitest";
import { exportAppData } from "./dataExport";

const mocks = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

beforeEach(() => {
  mocks.save.mockReset();
  mocks.invoke.mockReset();
});

test("cancel does not export, only the dialog-approved path is written, and failures propagate", async () => {
  mocks.save.mockResolvedValueOnce(null);
  expect(await exportAppData()).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith({
    title: "dataExport.dialogTitle",
    defaultPath: expect.stringMatching(/^pinote-data-.*\.zip$/),
    filters: [{ name: "diagnostics.dialog.zipArchive", extensions: ["zip"] }],
  });
  for (const selected of ["/backup/data", "/backup/data.ZIP"]) {
    mocks.save.mockResolvedValueOnce(selected);
    const destinationPath = selected;
    const result = { destinationPath, fileCount: 7 };
    mocks.invoke.mockResolvedValueOnce(result);
    expect(await exportAppData()).toEqual(result);
    expect(mocks.invoke).toHaveBeenLastCalledWith("export_app_data", {
      destinationPath,
    });
  }
  mocks.save.mockResolvedValueOnce("/backup/data.zip");
  mocks.invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(exportAppData()).rejects.toThrow("disk full");
});
