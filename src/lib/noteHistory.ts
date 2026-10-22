import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { getNoteIdFromPath } from "@/lib/notes";

export interface NoteHistoryEntry {
  notePath: string;
  noteId: string;
  windowId: string;
  lastOpenedAt: string;
}

export interface NoteHistorySearchResult extends NoteHistoryEntry {
  matchedByContent: boolean;
}

export interface NoteHistorySearchSnapshot {
  results: NoteHistorySearchResult[];
  total: number;
}

export interface NoteDeleteFailure {
  notePath: string;
  reason: string;
}

const CONTENT_SEARCH_BATCH_SIZE = 32;

function includesText(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

async function checkContentMatch(notePath: string, query: string) {
  try {
    const content = await readTextFile(notePath);
    return includesText(content, query);
  } catch {
    return false;
  }
}

export async function recordOpenedNote(params: {
  notePath: string;
  noteId: string;
  windowId: string;
}) {
  const notePath = params.notePath.trim();
  const windowId = params.windowId.trim();
  if (!notePath || !windowId) return;
  await invoke<void>("record_note_history", {
    params: {
      notePath,
      noteId: params.noteId.trim() || getNoteIdFromPath(notePath),
      windowId,
    },
  });
}

export function listNoteHistoryEntries() {
  return invoke<NoteHistoryEntry[]>("list_note_history");
}

export async function searchNoteHistory(
  query: string,
): Promise<NoteHistorySearchSnapshot> {
  const normalizedQuery = query.trim().toLowerCase();
  const entries = await listNoteHistoryEntries();
  if (!normalizedQuery) {
    return {
      results: entries.map((entry) => ({
        ...entry,
        matchedByContent: false,
      })),
      total: entries.length,
    };
  }
  const metadataMatches = entries.map((entry) => {
    return includesText(entry.notePath, normalizedQuery);
  });
  const contentMatches: boolean[] = [];
  for (
    let start = 0;
    start < entries.length;
    start += CONTENT_SEARCH_BATCH_SIZE
  ) {
    const matches = await Promise.all(
      entries
        .slice(start, start + CONTENT_SEARCH_BATCH_SIZE)
        .map((entry, index) => {
          if (metadataMatches[start + index]) return false;
          return checkContentMatch(entry.notePath, normalizedQuery);
        }),
    );
    contentMatches.push(...matches);
  }
  const results: NoteHistorySearchResult[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (!metadataMatches[index] && !contentMatches[index]) continue;
    results.push({
      ...entries[index],
      matchedByContent: contentMatches[index],
    });
  }
  return { results, total: entries.length };
}

export function deleteHistoryNotes(notePaths: string[]) {
  return invoke<{ deleted: string[]; failures: NoteDeleteFailure[] }>(
    "delete_history_notes",
    { notePaths },
  );
}
