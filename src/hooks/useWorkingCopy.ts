import { invoke } from "@tauri-apps/api/core";
import { dirname } from "@tauri-apps/api/path";
import type { getCurrentWindow } from "@tauri-apps/api/window";
import { watchImmediate } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { logError } from "@/lib/logger";
import type { DocumentIssue, WorkingCopy } from "@/lib/workingCopy";

export function useWorkingCopy(
  document: WorkingCopy,
  appWindow: ReturnType<typeof getCurrentWindow>,
  notePath: string,
  onReload: () => void,
  persistWindowState: () => Promise<boolean>,
) {
  const callbacks = useRef({ onReload, persistWindowState });
  callbacks.current = { onReload, persistWindowState };
  const subscribe = useCallback(
    (listener: () => void) => {
      let previous = document.getSnapshot();
      return document.subscribe(() => {
        const next = document.getSnapshot();
        if (next.reload !== previous.reload && previous.content !== null)
          callbacks.current.onReload();
        previous = next;
        listener();
      });
    },
    [document],
  );
  const snapshot = useSyncExternalStore(subscribe, document.getSnapshot);

  useEffect(() => {
    let disposed = false;
    const handlers: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const register = async (registration: Promise<() => void>) => {
      const unlisten = await registration;
      if (disposed) unlisten();
      else handlers.push(unlisten);
    };
    const check = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) void document.checkExternal();
      }, 120);
    };
    const normalize = (path: string) => path.replace(/\\/g, "/").toLowerCase();
    const setup = async () => {
      await Promise.all([
        register(
          appWindow.listen("note-close-requested", () => {
            if (!disposed) void document.end("close");
          }),
        ),
        register(
          appWindow.listen<DocumentIssue | null>(
            "note-session-ended",
            ({ payload }) => {
              if (!disposed) document.markEnded(payload);
            },
          ),
        ),
        register(
          appWindow.listen<string>(
            "note-prepare-exit",
            ({ payload: attempt }) => {
              if (disposed) return;
              void (async () => {
                let ready = await document.prepareExit(attempt);
                if (ready && document.getSnapshot().phase !== "ended")
                  ready = await callbacks.current.persistWindowState();
                const confirmed = await invoke<boolean>("complete_note_exit", {
                  attempt,
                  ready,
                });
                if (disposed) return;
                if (confirmed) document.markEnded();
                else document.cancelExit(attempt);
              })().catch((error: unknown) => {
                document.report(error);
              });
            },
          ),
        ),
        register(
          appWindow.listen<string>("note-cancel-exit", ({ payload }) => {
            if (!disposed) document.cancelExit(payload);
          }),
        ),
      ]);
      if (!disposed) await document.load();
    };
    void setup().catch((error: unknown) => {
      if (!disposed) document.report(error);
    });
    void dirname(notePath)
      .then(async (directory) => {
        if (disposed) return;
        await register(
          watchImmediate(
            directory,
            (event) => {
              if (
                event.paths.length === 0 ||
                event.paths.some(
                  (path) => normalize(path) === normalize(notePath),
                )
              )
                check();
            },
            { recursive: false },
          ),
        );
      })
      .catch((error: unknown) => {
        logError("note-window", "external_watch_setup_failed", error, {
          notePath,
        });
      });
    window.addEventListener("focus", check);
    return () => {
      disposed = true;
      for (const unlisten of handlers) unlisten();
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.disconnect();
    };
  }, [appWindow, document, notePath]);

  return snapshot;
}
