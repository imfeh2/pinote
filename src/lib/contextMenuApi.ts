import { invoke } from "@tauri-apps/api/core";
import { emitTo, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

const NOTE_CONTEXT_MENU_ACTION_EVENT = "note-context-menu-action";
const NOTE_CONTEXT_MENU_SYNC_EVENT = "note-context-menu-sync";

export type NoteContextMenuAction =
  | "new-note"
  | "open-settings"
  | "minimize-window"
  | "toggle-maximize"
  | "toggle-always-on-top"
  | "toggle-read-only"
  | "toggle-theme"
  | "show-all-hidden-windows"
  | "hide-window"
  | "close-window"
  | "delete-note";

export interface NoteContextMenuContext {
  targetWindowLabel: string;
  noteId: string;
  notePath: string;
  noteOpacity: number;
  noteReadOnly: boolean;
  maximized: boolean;
  alwaysOnTop: boolean;
}

interface OpenNoteContextMenuOptions {
  targetWindowLabel: string;
  noteId: string;
  notePath: string;
  screenX: number;
  screenY: number;
  noteOpacity?: number;
  noteReadOnly: boolean;
}

interface NoteContextMenuActionPayload {
  action: NoteContextMenuAction;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export async function closeNoteContextMenu(targetWindowLabel: string) {
  await invoke("close_context_menu", { targetWindowLabel });
}

export async function openNoteContextMenu(options: OpenNoteContextMenuOptions) {
  await invoke("open_context_menu", { request: options });
}

export async function showNoteContextMenu() {
  await invoke("show_context_menu");
}

export async function listenNoteContextMenuAction(
  handler: (action: NoteContextMenuAction) => void,
): Promise<UnlistenFn> {
  const window = getCurrentWindow();
  return window.listen<NoteContextMenuActionPayload>(
    NOTE_CONTEXT_MENU_ACTION_EVENT,
    ({ payload }) => {
      if (!payload || typeof payload.action !== "string") return;
      handler(payload.action as NoteContextMenuAction);
    },
  );
}

export async function emitNoteContextMenuAction(
  targetWindowLabel: string,
  action: NoteContextMenuAction,
) {
  await emitTo<NoteContextMenuActionPayload>(
    targetWindowLabel,
    NOTE_CONTEXT_MENU_ACTION_EVENT,
    {
      action,
    },
  );
}

export async function listenNoteContextMenuSync(
  handler: (context: NoteContextMenuContext) => void,
): Promise<UnlistenFn> {
  const window = getCurrentWindow();
  return window.listen<NoteContextMenuContext>(
    NOTE_CONTEXT_MENU_SYNC_EVENT,
    ({ payload }) => {
      if (!payload) return;
      if (typeof payload.targetWindowLabel !== "string") return;
      if (typeof payload.noteId !== "string") return;
      if (typeof payload.notePath !== "string") return;
      const noteOpacity = clamp(
        Number.isFinite(payload.noteOpacity) ? payload.noteOpacity : 1,
        0,
        1,
      );
      handler({
        ...payload,
        noteOpacity,
        noteReadOnly: payload.noteReadOnly === true,
        maximized: payload.maximized === true,
        alwaysOnTop: payload.alwaysOnTop === true,
      });
    },
  );
}
