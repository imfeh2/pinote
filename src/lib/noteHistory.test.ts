import { beforeEach, expect, test, vi } from "vitest";
import {
  deleteHistoryNotes,
  listNoteHistoryEntries,
  recordOpenedNote,
  searchNoteHistory,
} from "./noteHistory";
import { buildNoteCacheKey } from "./notes";

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  remove: vi.fn(),
  stat: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => fs.files.has(path),
  readTextFile: async (path: string) => {
    const content = fs.files.get(path);
    if (content === undefined) throw new Error("File not found");
    return content;
  },
  mkdir: async () => {},
  remove: fs.remove,
  stat: fs.stat,
  writeTextFile: fs.write,
}));
vi.mock("@/lib/logger", () => ({ logInfo: vi.fn(), logError: vi.fn() }));

function seed(count: number) {
  const entries = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const notePath = `/notes/${index}.md`;
      fs.files.set(notePath, index === count - 1 ? "unique content" : "note");
      return [
        buildNoteCacheKey(notePath),
        {
          notePath,
          noteId: String(index),
          windowId: `note-${index}`,
          lastOpenedAt: "2026-01-01",
        },
      ];
    }),
  );
  fs.files.set(
    "history.json",
    JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01",
      entries,
      order: Object.keys(entries),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.files.clear();
  fs.remove.mockImplementation(async (path: string) => {
    fs.files.delete(path);
  });
  fs.stat.mockResolvedValue({ isFile: true });
  fs.write.mockImplementation(async (path: string, content: string) => {
    fs.files.set(path, content);
  });
});

test("keeps more than 1000 entries and searches beyond the old display limit", async () => {
  seed(1001);
  await recordOpenedNote({
    notePath: "/notes/new.md",
    noteId: "new",
    windowId: "note-new",
  });
  expect(await listNoteHistoryEntries()).toHaveLength(1002);
  const all = await searchNoteHistory("");
  expect(all.results).toHaveLength(1002);
  expect(all.total).toBe(1002);
  expect((await searchNoteHistory("/notes/")).results).toHaveLength(1002);
  expect(await searchNoteHistory("unique content")).toMatchObject({
    results: [{ notePath: "/notes/1000.md", matchedByContent: true }],
    total: 1002,
  });
  expect(await searchNoteHistory("no matches")).toEqual({
    results: [],
    total: 1002,
  });
});

test("deletes each selected file once, cleans missing files, and preserves failed and unselected entries", async () => {
  seed(4);
  fs.files.delete("/notes/1.md");
  fs.remove.mockImplementation(async (path: string) => {
    if (path === "/notes/2.md") throw new Error("Permission denied");
    fs.files.delete(path);
  });
  const result = await deleteHistoryNotes([
    "/notes/0.md",
    "/notes/1.md",
    "/notes/2.md",
    "/notes/0.md",
  ]);
  expect(result).toEqual({
    deleted: ["/notes/0.md", "/notes/1.md"],
    failures: [{ notePath: "/notes/2.md", reason: "Permission denied" }],
  });
  expect((await listNoteHistoryEntries()).map((item) => item.notePath)).toEqual(
    ["/notes/2.md", "/notes/3.md"],
  );
  expect(await searchNoteHistory("/notes/2.md")).toMatchObject({
    results: [{ notePath: "/notes/2.md" }],
    total: 2,
  });
  expect(fs.files.has("/notes/0.md")).toBe(false);
  expect(fs.files.has("/notes/3.md")).toBe(true);
  expect(
    fs.remove.mock.calls.filter(([path]) => path === "/notes/0.md"),
  ).toHaveLength(1);
});

test("rejects unknown paths and directories without deleting them", async () => {
  seed(1);
  fs.stat.mockResolvedValue({ isFile: false });
  const result = await deleteHistoryNotes(["/outside.md", "/notes/0.md"]);
  expect(result.deleted).toEqual([]);
  expect(result.failures).toHaveLength(2);
  expect(fs.remove).not.toHaveBeenCalled();
});

test("surfaces a history write failure and allows cleanup to be retried", async () => {
  seed(1);
  fs.write.mockRejectedValueOnce(new Error("History write denied"));
  expect(await deleteHistoryNotes(["/notes/0.md"])).toEqual({
    deleted: [],
    failures: [
      {
        notePath: "/notes/0.md",
        reason: "Could not update history: History write denied",
      },
    ],
  });
  expect(fs.files.has("/notes/0.md")).toBe(false);
  expect(await listNoteHistoryEntries()).toHaveLength(1);
  expect((await deleteHistoryNotes(["/notes/0.md"])).deleted).toEqual([
    "/notes/0.md",
  ]);
  expect(await listNoteHistoryEntries()).toHaveLength(0);
});
