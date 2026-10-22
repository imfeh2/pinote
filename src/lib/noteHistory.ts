import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { logError, logInfo } from "@/lib/logger";
import { buildNoteCacheKey, getNoteIdFromPath } from "@/lib/notes";

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

interface NoteHistoryStore {
  version: number;
  updatedAt: string;
  entries: Record<string, NoteHistoryEntry>;
  order: string[];
}

const STORE_VERSION = 1;
const STORE_FILE = "history.json";
const STORE_LOCK_DIR = "note-history.lock";
const STORE_LOCK_RETRY_MS = 20;
const STORE_LOCK_TIMEOUT_MS = 1000;
const CONTENT_SEARCH_BATCH_SIZE = 32;

let mutationQueue = Promise.resolve();

function asString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function buildEmptyStore(): NoteHistoryStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    entries: {},
    order: [],
  };
}

function sanitizeHistoryEntry(value: unknown): NoteHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const notePath = asString(source.notePath);
  const noteId = asString(source.noteId);
  const windowId = asString(source.windowId);
  const lastOpenedAt = asString(source.lastOpenedAt);
  if (!notePath || !windowId) return null;
  return {
    notePath,
    noteId: noteId || getNoteIdFromPath(notePath),
    windowId,
    lastOpenedAt: lastOpenedAt || new Date(0).toISOString(),
  };
}

function sanitizeHistoryStore(value: unknown): NoteHistoryStore {
  if (!value || typeof value !== "object") return buildEmptyStore();
  const source = value as Record<string, unknown>;
  if (source.version !== STORE_VERSION) return buildEmptyStore();
  const entriesSource =
    source.entries && typeof source.entries === "object"
      ? (source.entries as Record<string, unknown>)
      : {};
  const entries: Record<string, NoteHistoryEntry> = {};
  for (const [key, item] of Object.entries(entriesSource)) {
    const parsed = sanitizeHistoryEntry(item);
    if (!parsed) continue;
    entries[key] = parsed;
  }
  const knownKeys = new Set(Object.keys(entries));
  const orderSource = Array.isArray(source.order) ? source.order : [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const item of orderSource) {
    const key = asString(item);
    if (!key || seen.has(key) || !knownKeys.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  const remainingKeys = Array.from(knownKeys).filter((key) => !seen.has(key));
  remainingKeys.sort((left, right) => {
    const leftTime = entries[left]?.lastOpenedAt ?? "";
    const rightTime = entries[right]?.lastOpenedAt ?? "";
    return rightTime.localeCompare(leftTime);
  });
  order.push(...remainingKeys);
  return {
    version: STORE_VERSION,
    updatedAt: asString(source.updatedAt) || new Date().toISOString(),
    entries,
    order,
  };
}

async function readStore() {
  const fileExists = await exists(STORE_FILE, {
    baseDir: BaseDirectory.AppData,
  });
  if (!fileExists) return buildEmptyStore();
  const content = await readTextFile(STORE_FILE, {
    baseDir: BaseDirectory.AppData,
  });
  try {
    return sanitizeHistoryStore(JSON.parse(content) as unknown);
  } catch {
    return buildEmptyStore();
  }
}

async function writeStore(store: NoteHistoryStore) {
  await writeTextFile(STORE_FILE, JSON.stringify(store, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function acquireStoreLock() {
  const startedAt = Date.now();
  let hasForcedUnlock = false;
  while (true) {
    try {
      await mkdir(STORE_LOCK_DIR, { baseDir: BaseDirectory.AppData });
      return;
    } catch {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= STORE_LOCK_TIMEOUT_MS && !hasForcedUnlock) {
        hasForcedUnlock = true;
        await remove(STORE_LOCK_DIR, {
          baseDir: BaseDirectory.AppData,
          recursive: true,
        }).catch(() => {});
      }
      if (elapsed >= STORE_LOCK_TIMEOUT_MS * 2) {
        throw new Error("Failed to acquire note history lock");
      }
      await delay(STORE_LOCK_RETRY_MS);
    }
  }
}

async function releaseStoreLock() {
  await remove(STORE_LOCK_DIR, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  }).catch(() => {});
}

async function mutateStore<T>(
  updater: (store: NoteHistoryStore) => Promise<T> | T,
): Promise<T> {
  let resolveValue: ((value: T | PromiseLike<T>) => void) | null = null;
  let rejectValue: ((reason?: unknown) => void) | null = null;
  const result = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  mutationQueue = mutationQueue
    .then(async () => {
      await acquireStoreLock();
      try {
        const store = await readStore();
        const next = await updater(store);
        await writeStore(store);
        resolveValue?.(next);
      } finally {
        await releaseStoreLock();
      }
    })
    .catch((error) => {
      rejectValue?.(error);
    });
  await mutationQueue.catch(() => {});
  return result;
}

function touchOrder(store: NoteHistoryStore, key: string) {
  const existing = store.order.filter((item) => item !== key);
  store.order = [key, ...existing];
}

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
  const noteId = params.noteId.trim() || getNoteIdFromPath(notePath);
  await mutateStore(async (store) => {
    const now = new Date().toISOString();
    const key = buildNoteCacheKey(notePath);
    store.entries[key] = {
      notePath,
      noteId,
      windowId,
      lastOpenedAt: now,
    };
    touchOrder(store, key);
    store.updatedAt = now;
  });
}

export async function listNoteHistoryEntries() {
  const store = await readStore();
  return store.order
    .map((key) => store.entries[key])
    .filter((item): item is NoteHistoryEntry => Boolean(item));
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

export interface NoteDeleteFailure {
  notePath: string;
  reason: string;
}

export async function deleteHistoryNotes(notePaths: string[]) {
  const entries = await listNoteHistoryEntries();
  const knownPaths = new Set(entries.map((entry) => entry.notePath));
  const deleted: string[] = [];
  const failures: NoteDeleteFailure[] = [];
  logInfo("history", "delete_requested", { count: notePaths.length });
  for (const notePath of new Set(notePaths)) {
    try {
      if (!knownPaths.has(notePath))
        throw new Error("Note is no longer in history.");
      if (await exists(notePath)) {
        const metadata = await stat(notePath);
        if (!metadata.isFile) throw new Error("The path is not a file.");
        await remove(notePath);
      }
      deleted.push(notePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ notePath, reason });
      logError("history", "delete_failed", error, { notePath });
    }
  }
  if (deleted.length > 0) {
    const deletedPaths = new Set(deleted);
    try {
      await mutateStore((store) => {
        for (const [key, entry] of Object.entries(store.entries)) {
          if (deletedPaths.has(entry.notePath)) delete store.entries[key];
        }
        store.order = store.order.filter((key) => Boolean(store.entries[key]));
        store.updatedAt = new Date().toISOString();
      });
    } catch (error) {
      const reason = `Could not update history: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(...deleted.map((notePath) => ({ notePath, reason })));
      deleted.length = 0;
      logError("history", "delete_history_update_failed", error);
    }
  }
  logInfo("history", "delete_finished", { deleted, failed: failures.length });
  return { deleted, failures };
}
