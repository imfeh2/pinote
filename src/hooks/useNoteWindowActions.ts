import type { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  closeNoteContextMenu,
  listenNoteContextMenuAction,
  type NoteContextMenuAction,
} from "@/lib/contextMenuApi";
import { logError, logInfo } from "@/lib/logger";
import { shortcutMatchesEvent } from "@/lib/shortcuts";
import { openNoteWindow, openSettingsWindow } from "@/lib/windowApi";
import type { Settings } from "@/stores/settings";

interface UseNoteWindowActionsOptions {
  appWindow: ReturnType<typeof getCurrentWindow>;
  settings: Settings;
  interactionBlocked: boolean;
  requestDelete: () => void;
  notePath: string;
  windowLabel: string;
  noteOpacityRef: MutableRefObject<number>;
  noteReadOnlyRef: MutableRefObject<boolean>;
  hideWindow: () => Promise<void>;
  persistWindowState: (
    visibility?: "visible" | "hidden",
    pushHiddenToTop?: boolean,
    opacity?: number,
    scrollTop?: number,
    readOnly?: boolean,
  ) => Promise<boolean>;
  setNoteReadOnly: (value: boolean) => void;
  toggleAlwaysOnTop: () => Promise<void> | void;
  toggleTheme: () => void;
}

function consumeKeyboardEvent(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

export function useNoteWindowActions(options: UseNoteWindowActionsOptions) {
  const {
    appWindow,
    settings,
    interactionBlocked,
    requestDelete,
    notePath,
    windowLabel,
    noteOpacityRef,
    noteReadOnlyRef,
    hideWindow,
    persistWindowState,
    setNoteReadOnly,
    toggleAlwaysOnTop,
    toggleTheme,
  } = options;

  const openSettings = useCallback(() => {
    openSettingsWindow().catch((error) => {
      logError("note-window", "open_settings_window_failed", error, {
        windowId: windowLabel,
      });
    });
  }, [windowLabel]);

  const openNote = useCallback(() => {
    appWindow
      .isAlwaysOnTop()
      .then((currentAlwaysOnTop) => {
        return openNoteWindow({
          alwaysOnTop: currentAlwaysOnTop,
          opacity: noteOpacityRef.current,
          skipTaskbar: settings.hideNoteWindowsFromTaskbar,
          centerOnCreate: true,
        });
      })
      .catch((error) => {
        logError("note-window", "open_note_window_failed", error, {
          windowId: windowLabel,
          notePath,
        });
      });
  }, [
    appWindow,
    noteOpacityRef,
    notePath,
    settings.hideNoteWindowsFromTaskbar,
    windowLabel,
  ]);

  const minimizeWindow = useCallback(() => {
    if (settings.hideNoteWindowsFromTaskbar) {
      void hideWindow();
      return;
    }
    appWindow.minimize().catch((error) => {
      logError("note-window", "minimize_window_failed", error, {
        windowId: windowLabel,
      });
    });
  }, [appWindow, hideWindow, settings.hideNoteWindowsFromTaskbar, windowLabel]);

  const toggleMaximizeWindow = useCallback(() => {
    appWindow
      .isMaximized()
      .then((maximized) => {
        if (maximized) {
          return appWindow.unmaximize();
        }
        return appWindow.maximize();
      })
      .catch((error) => {
        logError("note-window", "toggle_maximize_window_failed", error, {
          windowId: windowLabel,
        });
      });
  }, [appWindow, windowLabel]);

  const toggleReadOnly = useCallback(() => {
    const nextReadOnly = !noteReadOnlyRef.current;
    noteReadOnlyRef.current = nextReadOnly;
    setNoteReadOnly(nextReadOnly);
    logInfo("note-window", "toggle_read_only", {
      windowId: windowLabel,
      next: nextReadOnly,
    });
    void persistWindowState(
      undefined,
      false,
      undefined,
      undefined,
      nextReadOnly,
    );
  }, [noteReadOnlyRef, persistWindowState, setNoteReadOnly, windowLabel]);

  const closeWindow = useCallback(() => {
    logInfo("note-window", "close_window", { windowId: windowLabel });
    appWindow.close().catch((error) => {
      logError("note-window", "close_window_failed", error, {
        windowId: windowLabel,
      });
    });
  }, [appWindow, windowLabel]);

  const startWindowDrag = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || interactionBlocked) return;
      event.preventDefault();
      logInfo("note-window", "window_drag_start", { windowId: windowLabel });
      appWindow.startDragging().catch((error) => {
        logError("note-window", "start_dragging_failed", error, {
          windowId: windowLabel,
        });
      });
    },
    [appWindow, interactionBlocked, windowLabel],
  );

  const localShortcutActions = useMemo(
    () => [
      {
        shortcut: settings.shortcuts.hideWindow,
        action: hideWindow,
      },
      {
        shortcut: settings.shortcuts.closeWindow,
        action: closeWindow,
      },
      { shortcut: settings.shortcuts.deleteNote, action: requestDelete },
      {
        shortcut: settings.shortcuts.toggleAlwaysOnTop,
        action: toggleAlwaysOnTop,
      },
      {
        shortcut: settings.shortcuts.toggleReadOnly,
        action: toggleReadOnly,
      },
      {
        shortcut: settings.shortcuts.toggleTheme,
        action: toggleTheme,
      },
    ],
    [
      closeWindow,
      hideWindow,
      settings.shortcuts.closeWindow,
      settings.shortcuts.deleteNote,
      requestDelete,
      settings.shortcuts.hideWindow,
      settings.shortcuts.toggleAlwaysOnTop,
      settings.shortcuts.toggleReadOnly,
      settings.shortcuts.toggleTheme,
      toggleAlwaysOnTop,
      toggleReadOnly,
      toggleTheme,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      for (const item of localShortcutActions) {
        if (!shortcutMatchesEvent(item.shortcut, event)) continue;
        if (interactionBlocked && item.action !== closeWindow) return;
        consumeKeyboardEvent(event);
        item.action();
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [closeWindow, interactionBlocked, localShortcutActions]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const handleAction = (action: NoteContextMenuAction) => {
      if (interactionBlocked && action !== "close-window") return;
      if (action === "delete-note") {
        requestDelete();
        return;
      }
      if (action === "new-note") {
        openNote();
        return;
      }
      if (action === "open-settings") {
        openSettings();
        return;
      }
      if (action === "minimize-window") {
        minimizeWindow();
        return;
      }
      if (action === "toggle-maximize") {
        toggleMaximizeWindow();
        return;
      }
      if (action === "toggle-read-only") {
        toggleReadOnly();
        return;
      }
      if (action === "hide-window") {
        void hideWindow();
        return;
      }
      if (action === "close-window") {
        closeWindow();
      }
    };

    void listenNoteContextMenuAction(handleAction)
      .then((handler) => {
        if (disposed) {
          handler();
          return;
        }
        unlisten = handler;
      })
      .catch((error) => {
        logError("note-window", "listen_context_menu_actions_failed", error, {
          windowId: windowLabel,
        });
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
      void closeNoteContextMenu(windowLabel);
    };
  }, [
    closeWindow,
    hideWindow,
    interactionBlocked,
    requestDelete,
    minimizeWindow,
    openNote,
    openSettings,
    toggleMaximizeWindow,
    toggleReadOnly,
    windowLabel,
  ]);

  return {
    startWindowDrag,
  };
}
