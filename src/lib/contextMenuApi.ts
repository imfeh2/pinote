import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";

const NOTE_CONTEXT_MENU_ACTION_EVENT = "note-context-menu-action";
const NOTE_CONTEXT_MENU_SYNC_EVENT = "note-context-menu-sync";
const NOTE_CONTEXT_MENU_WINDOW_SUFFIX = "-context-menu";
const NOTE_CONTEXT_MENU_WIDTH = 224;
const NOTE_CONTEXT_MENU_HEIGHT = 180;
const NOTE_CONTEXT_MENU_GAP = 8;

export type NoteContextMenuAction =
  | "new-note"
  | "open-settings"
  | "minimize-window"
  | "toggle-maximize"
  | "toggle-read-only"
  | "hide-window"
  | "close-window"
  | "delete-note";

export interface NoteContextMenuContext {
  targetWindowLabel: string;
  noteId: string;
  notePath: string;
  anchorX: number;
  anchorY: number;
  noteOpacity: number;
  noteReadOnly: boolean;
  maximized: boolean;
}

interface OpenNoteContextMenuOptions {
  parentWindowLabel: string;
  targetWindowLabel: string;
  noteId: string;
  notePath: string;
  screenX: number;
  screenY: number;
  scaleFactor: number;
  noteOpacity?: number;
  noteReadOnly: boolean;
}

interface NoteContextMenuActionPayload {
  action: NoteContextMenuAction;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function waitForWindowCreated(window: WebviewWindow) {
  await new Promise<void>((resolve, reject) => {
    window
      .once("tauri://created", () => {
        resolve();
      })
      .catch(reject);
    window
      .once("tauri://error", (event) => {
        reject(event.payload);
      })
      .catch(reject);
  });
}

function buildNoteContextMenuWindowLabel(parentWindowLabel: string) {
  return `${parentWindowLabel}${NOTE_CONTEXT_MENU_WINDOW_SUFFIX}`;
}

async function resolveContextMenuPosition(options: OpenNoteContextMenuOptions) {
  const scaleFactor =
    Number.isFinite(options.scaleFactor) && options.scaleFactor > 0
      ? options.scaleFactor
      : 1;
  return {
    x: Math.round(options.screenX * scaleFactor),
    y: Math.round(options.screenY * scaleFactor),
  };
}

async function resolveContextMenuWindowPosition(
  pointerX: number,
  pointerY: number,
  width: number,
  height: number,
) {
  const monitor = await monitorFromPoint(pointerX, pointerY).catch(() => null);
  if (!monitor) {
    return {
      x: pointerX,
      y: pointerY,
    };
  }
  const workArea = monitor.workArea;
  const minX = workArea.position.x + NOTE_CONTEXT_MENU_GAP;
  const minY = workArea.position.y + NOTE_CONTEXT_MENU_GAP;
  const maxX = Math.max(
    minX,
    workArea.position.x + workArea.size.width - width - NOTE_CONTEXT_MENU_GAP,
  );
  const maxY = Math.max(
    minY,
    workArea.position.y + workArea.size.height - height - NOTE_CONTEXT_MENU_GAP,
  );
  const rightSpace =
    workArea.position.x +
    workArea.size.width -
    pointerX -
    NOTE_CONTEXT_MENU_GAP;
  const leftSpace = pointerX - workArea.position.x - NOTE_CONTEXT_MENU_GAP;
  const bottomSpace =
    workArea.position.y +
    workArea.size.height -
    pointerY -
    NOTE_CONTEXT_MENU_GAP;
  const topSpace = pointerY - workArea.position.y - NOTE_CONTEXT_MENU_GAP;
  let x = pointerX;
  let y = pointerY;
  if (rightSpace < width && leftSpace >= width) {
    x = pointerX - width;
  }
  if (bottomSpace < height && topSpace >= height) {
    y = pointerY - height;
  }
  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY),
  };
}

function buildNoteContextMenuUrl(
  options: OpenNoteContextMenuOptions,
  pointer: { x: number; y: number },
  maximized: boolean,
) {
  const noteOpacity = clamp(
    typeof options.noteOpacity === "number" &&
      Number.isFinite(options.noteOpacity)
      ? options.noteOpacity
      : 1,
    0,
    1,
  );
  const query = new URLSearchParams({
    view: "context-menu",
    targetWindowLabel: options.targetWindowLabel,
    noteId: options.noteId,
    notePath: options.notePath,
    anchorX: String(pointer.x),
    anchorY: String(pointer.y),
    noteOpacity: noteOpacity.toString(),
    noteReadOnly: String(options.noteReadOnly),
    maximized: String(maximized),
  });
  return `index.html?${query.toString()}`;
}

function buildNoteContextMenuContext(
  options: OpenNoteContextMenuOptions,
  pointer: { x: number; y: number },
  maximized: boolean,
): NoteContextMenuContext {
  const noteOpacity = clamp(
    typeof options.noteOpacity === "number" &&
      Number.isFinite(options.noteOpacity)
      ? options.noteOpacity
      : 1,
    0,
    1,
  );
  return {
    targetWindowLabel: options.targetWindowLabel,
    noteId: options.noteId,
    notePath: options.notePath,
    anchorX: pointer.x,
    anchorY: pointer.y,
    noteOpacity,
    noteReadOnly: options.noteReadOnly,
    maximized,
  };
}

async function emitNoteContextMenuSync(
  targetLabel: string,
  context: NoteContextMenuContext,
) {
  await emitTo<NoteContextMenuContext>(
    targetLabel,
    NOTE_CONTEXT_MENU_SYNC_EVENT,
    context,
  );
}

export async function closeNoteContextMenu(parentWindowLabel: string) {
  const label = buildNoteContextMenuWindowLabel(parentWindowLabel);
  const existing = await WebviewWindow.getByLabel(label);
  if (!existing) return;
  await existing.hide().catch(() => {});
}

export async function openNoteContextMenu(options: OpenNoteContextMenuOptions) {
  const label = buildNoteContextMenuWindowLabel(options.parentWindowLabel);
  const pointer = await resolveContextMenuPosition(options);
  const targetWindow = await WebviewWindow.getByLabel(
    options.targetWindowLabel,
  );
  const maximized = await targetWindow?.isMaximized().catch(() => false);
  const context = buildNoteContextMenuContext(
    options,
    pointer,
    maximized ?? false,
  );
  let menuWindow = await WebviewWindow.getByLabel(label);
  if (!menuWindow) {
    menuWindow = new WebviewWindow(label, {
      url: buildNoteContextMenuUrl(options, pointer, maximized ?? false),
      title: "Pinote Menu",
      width: NOTE_CONTEXT_MENU_WIDTH,
      height: NOTE_CONTEXT_MENU_HEIGHT,
      decorations: false,
      transparent: true,
      backgroundColor: [0, 0, 0, 0],
      resizable: false,
      alwaysOnTop: true,
      shadow: false,
      skipTaskbar: true,
      visible: false,
      focus: true,
    } as ConstructorParameters<typeof WebviewWindow>[1]);
    await waitForWindowCreated(menuWindow);
    const persistentMenuWindow = menuWindow;
    await persistentMenuWindow.onCloseRequested((event) => {
      event.preventDefault();
      void persistentMenuWindow.hide();
    });
  }
  const size = await menuWindow.innerSize().catch(() => ({
    width: NOTE_CONTEXT_MENU_WIDTH,
    height: NOTE_CONTEXT_MENU_HEIGHT,
  }));
  const position = await resolveContextMenuWindowPosition(
    pointer.x,
    pointer.y,
    Math.max(1, Math.round(size.width)),
    Math.max(1, Math.round(size.height)),
  );
  await emitNoteContextMenuSync(label, context).catch(() => {});
  await menuWindow.setPosition(new PhysicalPosition(position.x, position.y));
  await menuWindow.show();
  await menuWindow.setFocus();
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
      if (typeof payload.anchorX !== "number") return;
      if (typeof payload.anchorY !== "number") return;
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
      });
    },
  );
}
