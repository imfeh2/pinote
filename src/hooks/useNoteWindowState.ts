import type { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { logError } from "@/lib/logger";
import {
  saveWindowPreferences,
  type WindowVisibility,
} from "@/lib/windowStateCache";
import type { WorkingCopy } from "@/lib/workingCopy";

interface UseNoteWindowStateOptions {
  appWindow: ReturnType<typeof getCurrentWindow>;
  document: WorkingCopy;
  initialScrollTop: number;
  noteOpacityRef: MutableRefObject<number>;
  noteReadOnlyRef: MutableRefObject<boolean>;
  noteScrollTopRef: MutableRefObject<number>;
}

export function useNoteWindowState({
  appWindow,
  document,
  initialScrollTop,
  noteOpacityRef,
  noteReadOnlyRef,
  noteScrollTopRef,
}: UseNoteWindowStateOptions) {
  const [initialEditorScrollTop, setInitialEditorScrollTop] =
    useState(initialScrollTop);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceHidden = useRef(false);
  const hiding = useRef(false);

  const persistWindowState = useCallback(
    async (
      visibility?: WindowVisibility,
      pushHiddenToTop = false,
      opacity?: number,
      scrollTop?: number,
      readOnly?: boolean,
      preserveHiddenVisibility = visibility === undefined,
    ) => {
      if (
        !["loading", "ready", "quitting"].includes(document.getSnapshot().phase)
      )
        return false;
      const nextVisibility =
        visibility ?? (forceHidden.current ? "hidden" : undefined);
      if (nextVisibility === "visible") forceHidden.current = false;
      try {
        await saveWindowPreferences(
          {
            opacity: Math.min(
              1,
              Math.max(0, opacity ?? noteOpacityRef.current),
            ),
            scrollTop: Math.max(0, scrollTop ?? noteScrollTopRef.current),
            readOnly: readOnly ?? noteReadOnlyRef.current,
            visibility: nextVisibility,
          },
          { pushHiddenToTop, preserveHiddenVisibility },
        );
        return true;
      } catch (error) {
        document.report(error);
        logError("note-window", "persist_window_state_failed", error, {
          windowId: appWindow.label,
        });
        return false;
      }
    },
    [appWindow, document, noteOpacityRef, noteReadOnlyRef, noteScrollTopRef],
  );

  const handleScrollTopChange = useCallback(
    (scrollTop: number) => {
      noteScrollTopRef.current = Math.max(
        0,
        Number.isFinite(scrollTop) ? scrollTop : 0,
      );
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        void persistWindowState();
      }, 200);
    },
    [noteScrollTopRef, persistWindowState],
  );

  const hideWindow = useCallback(async () => {
    if (hiding.current) return;
    hiding.current = true;
    forceHidden.current = true;
    if (scrollTimer.current) {
      clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    try {
      if (!(await persistWindowState("hidden", true))) {
        forceHidden.current = false;
        return;
      }
      await appWindow.hide();
    } catch (error) {
      forceHidden.current = false;
      await persistWindowState(
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        false,
      );
      document.report(error);
      logError("note-window", "hide_window_failed", error, {
        windowId: appWindow.label,
      });
    } finally {
      hiding.current = false;
    }
  }, [appWindow, document, persistWindowState]);

  useEffect(() => {
    let disposed = false;
    const handlers: Array<() => void> = [];
    for (const registration of [
      appWindow.onMoved(() => {
        void persistWindowState();
      }),
      appWindow.onResized(() => {
        void persistWindowState();
      }),
      appWindow.onFocusChanged(({ payload }) => {
        if (payload && !hiding.current)
          void persistWindowState(
            "visible",
            false,
            undefined,
            undefined,
            undefined,
            true,
          );
      }),
    ]) {
      void registration.then(
        (unlisten) => {
          if (disposed) unlisten();
          else handlers.push(unlisten);
        },
        (error: unknown) => {
          document.report(error);
        },
      );
    }
    return () => {
      disposed = true;
      for (const unlisten of handlers) unlisten();
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [appWindow, document, persistWindowState]);

  return {
    hideWindow,
    handleScrollTopChange,
    initialEditorScrollTop,
    persistWindowState,
    setInitialEditorScrollTop,
  };
}
