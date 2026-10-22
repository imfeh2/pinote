import { beforeEach, expect, test, vi } from "vitest";
import {
  deleteHistoryNotes,
  listNoteHistoryEntries,
  type NoteHistoryEntry,
  recordOpenedNote,
  removeHistoryRecords,
  searchNoteHistory,
} from "./noteHistory";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: mocks.read }));

beforeEach(() => {
  vi.resetAllMocks();
});

test("searches complete history and preserves the total across filters", async () => {
  const entries: NoteHistoryEntry[] = Array.from(
    { length: 1002 },
    (_, index) => ({
      notePath: `/notes/${index}.md`,
      noteId: String(index),
      windowId: `note-${index}`,
      lastOpenedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  mocks.invoke.mockResolvedValue(entries);
  mocks.read.mockImplementation(async (path: string) =>
    path === "/notes/1001.md" ? "unique content" : "note",
  );
  expect(await listNoteHistoryEntries()).toEqual(entries);
  const all = await searchNoteHistory("");
  expect(all.results).toHaveLength(1002);
  expect(all.total).toBe(1002);
  expect((await searchNoteHistory("/NOTES/")).results).toHaveLength(1002);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(await searchNoteHistory("unique content")).toMatchObject({
    results: [{ notePath: "/notes/1001.md", matchedByContent: true }],
    total: 1002,
  });
  expect(await searchNoteHistory("no matches")).toEqual({
    results: [],
    total: 1002,
  });
  expect(mocks.invoke).toHaveBeenLastCalledWith("list_note_history");
});

test("delegates recording and deletion to the shared history service", async () => {
  mocks.invoke.mockResolvedValue(undefined);
  await recordOpenedNote({
    notePath: " /notes/new.md ",
    noteId: "",
    windowId: " note-new ",
  });
  expect(mocks.invoke).toHaveBeenCalledWith("record_note_history", {
    params: { notePath: "/notes/new.md", noteId: "new", windowId: "note-new" },
  });
  mocks.invoke.mockClear();
  await recordOpenedNote({
    notePath: " ",
    noteId: "new",
    windowId: "note-new",
  });
  expect(mocks.invoke).not.toHaveBeenCalled();
  const result = {
    deleted: ["/notes/0.md"],
    failures: [{ notePath: "/notes/1.md", reason: "Permission denied" }],
  };
  mocks.invoke.mockResolvedValue(result);
  expect(await deleteHistoryNotes(["/notes/0.md", "/notes/1.md"])).toEqual(
    result,
  );
  expect(mocks.invoke).toHaveBeenCalledWith("delete_history_notes", {
    notePaths: ["/notes/0.md", "/notes/1.md"],
  });
  expect(await removeHistoryRecords(["/notes/0.md", "/notes/1.md"])).toEqual(
    result,
  );
  expect(mocks.invoke).toHaveBeenLastCalledWith("remove_history_records", {
    notePaths: ["/notes/0.md", "/notes/1.md"],
  });
});

test("propagates storage errors instead of presenting empty history or deletion success", async () => {
  const error = "Could not parse history";
  mocks.invoke.mockRejectedValue(error);
  await expect(searchNoteHistory("")).rejects.toBe(error);
  await expect(deleteHistoryNotes(["/notes/0.md"])).rejects.toBe(error);
  await expect(removeHistoryRecords(["/notes/0.md"])).rejects.toBe(error);
  await expect(
    recordOpenedNote({
      notePath: "/notes/0.md",
      noteId: "0",
      windowId: "note-0",
    }),
  ).rejects.toBe(error);
  expect(mocks.read).not.toHaveBeenCalled();
});
