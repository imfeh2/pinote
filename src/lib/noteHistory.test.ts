import { beforeEach, expect, test, vi } from "vitest";
import {
  deleteHistoryNotes,
  listNoteHistoryEntries,
  type NoteHistoryEntry,
  removeHistoryRecords,
  searchNoteHistory,
} from "./noteHistory";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
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
  mocks.invoke.mockImplementation(
    async (command: string, args?: { notePath: string }) => {
      if (command === "list_note_history") return entries;
      if (command === "read_note_file" && args)
        return { content: await mocks.read(args.notePath), version: "version" };
      throw new Error(`Unexpected command: ${command}`);
    },
  );
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
});

test("returns partial deletion results and keeps record removal separate", async () => {
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
  expect(mocks.read).not.toHaveBeenCalled();
});
