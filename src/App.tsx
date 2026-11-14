import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { Lock, Pin } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/AlertDialog";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Editor } from "@/components/Editor";
import { WindowDragHandle } from "@/components/WindowDragHandle";
import { useNoteWindowActions } from "@/hooks/useNoteWindowActions";
import { useNoteWindowMouseInteractions } from "@/hooks/useNoteWindowMouseInteractions";
import { useNoteWindowState } from "@/hooks/useNoteWindowState";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import { useWindowControl } from "@/hooks/useWindowControl";
import { useWorkingCopy } from "@/hooks/useWorkingCopy";
import { logError } from "@/lib/logger";
import {
  bringNoteWindowsBackOnScreen,
  getRuntimePlatform,
  type RuntimePlatform,
} from "@/lib/windowApi";
import { type EndResult, WorkingCopy } from "@/lib/workingCopy";
import {
  resolveEditorFontFamily,
  type WindowsGlassEffect,
} from "@/stores/settings";
import { refreshSettingsStore } from "@/stores/settingsStore";
import "@/styles/App.css";

const NOTE_OPACITY_MIN = 0;
const NOTE_OPACITY_MAX = 1;
const NOTE_WINDOW_BROUGHT_BACK_EVENT = "note-window-brought-back";
const NOTE_WINDOW_BROUGHT_BACK_FEEDBACK_MS = 260;
const NOTE_WINDOW_RECOVERY_DELAY_MS = 120;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getWindowsPrimaryEffect(effect: WindowsGlassEffect) {
  if (effect === "mica") return Effect.Mica;
  if (effect === "acrylic") return Effect.Acrylic;
  if (effect === "blur") return Effect.Blur;
  return null;
}

function getWindowsFallbackEffects(effect: WindowsGlassEffect) {
  if (effect === "mica") return [Effect.Acrylic, Effect.Blur];
  if (effect === "acrylic") return [Effect.Blur];
  return [];
}

function App({
  noteId,
  notePath,
  initialOpacity,
  initialReadOnly = false,
  initialScrollTop = 0,
}: {
  noteId: string;
  notePath: string;
  initialOpacity?: number;
  initialReadOnly?: boolean;
  initialScrollTop?: number;
}) {
  const { t } = useTranslation("note");
  const { toggleTheme } = useTheme();
  const { alwaysOnTop, toggleAlwaysOnTop: toggleWindowAlwaysOnTop } =
    useWindowControl();
  const { settings, updateSettings } = useSettings();
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const windowLabel = appWindow.label;
  const initialWindowOpacity = clamp(
    initialOpacity ?? 1,
    NOTE_OPACITY_MIN,
    NOTE_OPACITY_MAX,
  );
  const [workingCopy] = useState(() => new WorkingCopy());
  const [dialog, setDialog] = useState<"delete" | "discard" | null>(null);
  const [deleteResult, setDeleteResult] = useState<EndResult | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionSettingsError, setDeletionSettingsError] = useState<
    string | null
  >(null);
  const deletionPending = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [noteOpacity, setNoteOpacityState] = useState(initialWindowOpacity);
  const noteOpacityRef = useRef(initialWindowOpacity);
  const noteReadOnlyRef = useRef(initialReadOnly);
  const noteScrollTopRef = useRef(initialScrollTop);
  const [runtimePlatform, setRuntimePlatform] =
    useState<RuntimePlatform>("other");
  const [noteReadOnly, setNoteReadOnly] = useState(initialReadOnly);
  const [broughtBackFeedback, setBroughtBackFeedback] = useState(false);

  useEffect(() => {
    noteOpacityRef.current = noteOpacity;
  }, [noteOpacity]);

  useEffect(() => {
    noteReadOnlyRef.current = noteReadOnly;
  }, [noteReadOnly]);

  useEffect(() => {
    let disposed = false;
    getRuntimePlatform()
      .then((platform) => {
        if (disposed) return;
        setRuntimePlatform(platform);
      })
      .catch(() => {
        if (disposed) return;
        setRuntimePlatform("other");
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
    void appWindow
      .listen(NOTE_WINDOW_BROUGHT_BACK_EVENT, () => {
        if (disposed) return;
        setBroughtBackFeedback(true);
        if (feedbackTimer) {
          clearTimeout(feedbackTimer);
        }
        feedbackTimer = setTimeout(() => {
          if (disposed) return;
          setBroughtBackFeedback(false);
        }, NOTE_WINDOW_BROUGHT_BACK_FEEDBACK_MS);
      })
      .then((handler) => {
        if (disposed) {
          handler();
          return;
        }
        unlisten = handler;
      })
      .catch((error) => {
        logError("note-window", "listen_brought_back_event_failed", error, {
          windowId: windowLabel,
        });
      });
    return () => {
      disposed = true;
      if (feedbackTimer) {
        clearTimeout(feedbackTimer);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, [appWindow, windowLabel]);

  useEffect(() => {
    let disposed = false;
    let unlistenScale: (() => void) | null = null;
    let recoverTimer: ReturnType<typeof setTimeout> | null = null;
    const recoverNotes = () => {
      bringNoteWindowsBackOnScreen().catch((error) => {
        logError("note-window", "bring_notes_back_failed", error, {
          windowId: windowLabel,
        });
      });
    };
    recoverTimer = setTimeout(() => {
      if (disposed) return;
      recoverNotes();
    }, NOTE_WINDOW_RECOVERY_DELAY_MS);
    const handleFocus = () => {
      recoverNotes();
    };
    window.addEventListener("focus", handleFocus);
    void appWindow
      .onScaleChanged(() => {
        recoverNotes();
      })
      .then((handler) => {
        if (disposed) {
          handler();
          return;
        }
        unlistenScale = handler;
      })
      .catch((error) => {
        logError("note-window", "listen_scale_change_failed", error, {
          windowId: windowLabel,
        });
      });
    return () => {
      disposed = true;
      if (recoverTimer) {
        clearTimeout(recoverTimer);
      }
      window.removeEventListener("focus", handleFocus);
      if (unlistenScale) {
        unlistenScale();
      }
    };
  }, [appWindow, windowLabel]);

  const {
    hideWindow,
    handleScrollTopChange,
    initialEditorScrollTop,
    persistWindowState,
    setInitialEditorScrollTop,
  } = useNoteWindowState({
    appWindow,
    document: workingCopy,
    initialScrollTop,
    noteOpacityRef,
    noteReadOnlyRef,
    noteScrollTopRef,
  });

  const state = useWorkingCopy(
    workingCopy,
    appWindow,
    notePath,
    () => setInitialEditorScrollTop(Math.max(0, noteScrollTopRef.current)),
    persistWindowState,
  );
  const busy =
    deletionBusy || ["closing", "deleting", "quitting"].includes(state.phase);
  const interactionBlocked = busy || dialog !== null || state.phase !== "ready";
  const deleteNote = useCallback(async () => {
    const result = await workingCopy.end("delete");
    if (!result) return;
    setDeleteResult(result);
    if (result.error) setDialog("delete");
  }, [workingCopy]);
  const requestDelete = useCallback(async () => {
    if (deletionPending.current || workingCopy.getSnapshot().phase !== "ready")
      return;
    deletionPending.current = true;
    setDeletionBusy(true);
    returnFocusRef.current = globalThis.document
      .activeElement as HTMLElement | null;
    setDeleteResult(null);
    setDontAskAgain(false);
    setDeletionSettingsError(null);
    try {
      const current = await refreshSettingsStore();
      if (workingCopy.getSnapshot().phase !== "ready") return;
      if (current.confirmNoteDeletion) setDialog("delete");
      else await deleteNote();
    } catch (error) {
      logError("settings", "read_deletion_preference_failed", error);
      setDeletionSettingsError(t("deletion.preferencesUnavailable"));
      setDialog("delete");
    } finally {
      deletionPending.current = false;
      setDeletionBusy(false);
    }
  }, [deleteNote, t, workingCopy]);
  const confirmDeletion = async () => {
    if (deletionPending.current) return;
    deletionPending.current = true;
    setDeletionBusy(true);
    setDeletionSettingsError(null);
    try {
      if (dontAskAgain) await updateSettings({ confirmNoteDeletion: false });
      if (["ready", "uncertain"].includes(workingCopy.getSnapshot().phase))
        await deleteNote();
    } catch {
      setDeletionSettingsError(t("deletion.preferencesFailed"));
    } finally {
      deletionPending.current = false;
      setDeletionBusy(false);
    }
  };
  const retry = async () => {
    if (workingCopy.hasEndRequest) await workingCopy.retryEnd();
    else if (state.phase === "loading") await workingCopy.load();
    else if (await workingCopy.checkExternal()) {
      const saved = await workingCopy.save();
      if ((await persistWindowState()) && saved) workingCopy.dismissError();
    }
  };

  const toggleAlwaysOnTop = useCallback(async () => {
    const changed = await toggleWindowAlwaysOnTop();
    if (changed) await persistWindowState();
  }, [persistWindowState, toggleWindowAlwaysOnTop]);

  const { openContextMenu } = useNoteWindowMouseInteractions({
    appWindow,
    dragMouseButton: settings.dragMouseButton,
    interactionBlocked,
    noteId,
    notePath,
    noteOpacityRef,
    noteReadOnlyRef,
    noteScrollTopRef,
    persistWindowState,
    setNoteOpacityState,
    toggleAlwaysOnTop,
    wheelOpacityModifier: settings.wheelOpacityModifier,
    wheelResizeModifier: settings.wheelResizeModifier,
    windowLabel,
  });

  const { startWindowDrag } = useNoteWindowActions({
    appWindow,
    hideWindow,
    interactionBlocked,
    requestDelete,
    noteOpacityRef,
    notePath,
    noteReadOnlyRef,
    persistWindowState,
    setNoteReadOnly,
    settings,
    toggleAlwaysOnTop,
    toggleTheme,
    windowLabel,
  });

  const handleChange = useCallback(
    (markdown: string) => {
      if (noteReadOnlyRef.current) return;
      workingCopy.edit(markdown);
    },
    [workingCopy],
  );

  useEffect(() => {
    const applyEffects = async () => {
      if (runtimePlatform === "windows") {
        const selectedEffect = settings.noteGlassEffectWindows;
        const primaryEffect = getWindowsPrimaryEffect(selectedEffect);
        if (!primaryEffect) {
          await appWindow.clearEffects().catch((error) => {
            logError("note-window", "clear_effects_failed", error, {
              platform: runtimePlatform,
              reason: "windows_none",
            });
          });
          return;
        }
        const effectsToTry = [
          primaryEffect,
          ...getWindowsFallbackEffects(selectedEffect),
        ];
        for (const effect of effectsToTry) {
          const applied = await appWindow
            .setEffects({
              effects: [effect],
            })
            .then(() => true)
            .catch(() => false);
          if (applied) return;
        }
        await appWindow.clearEffects().catch((error) => {
          logError("note-window", "clear_effects_failed", error, {
            platform: runtimePlatform,
            reason: "windows_fallback_failed",
          });
        });
        return;
      }
      if (runtimePlatform === "macos") {
        if (!settings.noteGlassEffectMacos) {
          await appWindow.clearEffects().catch((error) => {
            logError("note-window", "clear_effects_failed", error, {
              platform: runtimePlatform,
              reason: "macos_disabled",
            });
          });
          return;
        }
        await appWindow
          .setEffects({
            effects: [Effect.HudWindow],
          })
          .catch((error) => {
            logError("note-window", "apply_macos_glass_effect_failed", error, {
              platform: runtimePlatform,
            });
          });
        return;
      }
      await appWindow.clearEffects().catch((error) => {
        logError("note-window", "clear_effects_failed", error, {
          platform: runtimePlatform,
          reason: "other_platform",
        });
      });
    };
    void applyEffects();
  }, [
    appWindow,
    runtimePlatform,
    settings.noteGlassEffectMacos,
    settings.noteGlassEffectWindows,
  ]);

  const editorStyle = useMemo(
    () =>
      ({
        "--editor-font-family": resolveEditorFontFamily(
          settings.editorFontFamily,
        ),
        "--editor-font-size": `${settings.editorFontSize}px`,
        "--editor-line-height": settings.editorLineHeight.toString(),
        "--editor-padding-x": `${settings.editorPaddingX}px`,
        "--editor-padding-y": `${settings.editorPaddingY}px`,
      }) as CSSProperties,
    [
      settings.editorFontFamily,
      settings.editorFontSize,
      settings.editorLineHeight,
      settings.editorPaddingX,
      settings.editorPaddingY,
    ],
  );

  const pinnedVisualStyle = useMemo(
    () =>
      ({
        "--pinote-visual-opacity": noteOpacity.toString(),
        "--pinote-visual-opacity-percent": `${Math.round(noteOpacity * 100)}%`,
      }) as CSSProperties,
    [noteOpacity],
  );

  const noteBackgroundStyle = useMemo(() => {
    return {
      opacity: noteOpacity,
    } as CSSProperties;
  }, [noteOpacity]);

  return (
    <main
      data-pinned={alwaysOnTop ? "true" : "false"}
      data-read-only={
        noteReadOnly || state.phase !== "ready" ? "true" : "false"
      }
      aria-busy={busy || state.phase === "loading"}
      data-brought-back={broughtBackFeedback ? "true" : "false"}
      className="pinote-window relative flex h-screen flex-col overflow-hidden rounded-lg"
      style={pinnedVisualStyle}
      onContextMenu={openContextMenu}
    >
      <div
        className="absolute inset-0 bg-background"
        style={noteBackgroundStyle}
      />
      <WindowDragHandle onMouseDown={startWindowDrag} />
      {(state.error && state.error.kind !== "conflict") ||
      state.phase === "ended" ? (
        <div
          className="relative z-40 max-h-[60vh] shrink-0 overflow-y-auto border-b border-border bg-background p-2 text-xs"
          role="alert"
        >
          <p className="break-words">
            {t(`errors.${state.error?.kind ?? "ended"}`)}
          </p>
          {state.error && "message" in state.error ? (
            <p className="mt-1 break-words text-muted-foreground">
              {state.error.message}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {state.phase !== "ended" ? (
              <Button
                disabled={busy}
                onClick={() => {
                  void retry();
                }}
              >
                {t("actions.retry")}
              </Button>
            ) : null}
            {workingCopy.dirty && state.phase === "ready" ? (
              <Button
                onClick={() => {
                  returnFocusRef.current = globalThis.document
                    .activeElement as HTMLElement | null;
                  setDialog("discard");
                }}
              >
                {t("actions.discard")}
              </Button>
            ) : null}
            <Button
              disabled={busy}
              onClick={() => {
                void workingCopy.end("close");
              }}
            >
              {t("actions.close")}
            </Button>
          </div>
        </div>
      ) : null}
      {state.external ? (
        <div
          className="relative z-40 flex max-h-[60vh] shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-b border-amber-400/50 bg-amber-300/20 px-2.5 py-1.5 text-xs text-amber-950 dark:border-amber-300/45 dark:bg-amber-200/12 dark:text-amber-100"
          role="alert"
        >
          <span className="min-w-0 flex-1 break-words">
            {t("externalChange.message")}
          </span>
          <Button
            variant="ghost"
            disabled={interactionBlocked}
            onClick={() => {
              void workingCopy.reloadExternal();
            }}
          >
            {t("externalChange.reload")}
          </Button>
          <Button
            variant="ghost"
            disabled={interactionBlocked}
            onClick={() => {
              void workingCopy.keepCurrent();
            }}
          >
            {t("externalChange.ignore")}
          </Button>
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1.5">
        {noteReadOnly ? (
          <div
            className="pinote-readonly-badge flex h-5 w-5 items-center justify-center rounded-full transition-all duration-200"
            style={{ opacity: noteOpacity }}
            role="img"
            aria-label={t("status.readOnly")}
          >
            <Lock size={11} aria-hidden="true" />
          </div>
        ) : null}
        {alwaysOnTop ? (
          <div
            className="pinote-pinned-badge flex h-5 w-5 items-center justify-center rounded-full transition-all duration-200"
            style={{ opacity: noteOpacity }}
            role="img"
            aria-label={t("status.alwaysOnTop")}
          >
            <Pin size={11} aria-hidden="true" />
          </div>
        ) : null}
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {state.content === null ? (
          <div
            className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground"
            role="status"
          >
            {state.error ? null : t("loading")}
          </div>
        ) : (
          <Editor
            key={`editor-${state.reload}`}
            defaultValue={state.content}
            onChange={handleChange}
            readOnly={noteReadOnly || interactionBlocked}
            initialScrollTop={initialEditorScrollTop}
            onScrollTopChange={handleScrollTopChange}
            style={editorStyle}
          />
        )}
        <AlertDialog
          open={dialog !== null}
          title={dialog === "delete" ? t("deletion.title") : t("discard.title")}
          description={
            dialog === "delete"
              ? state.phase === "ended"
                ? deleteResult?.ended && deleteResult.error?.kind === "io"
                  ? t("deletion.cleanupFailed")
                  : t("errors.ended")
                : t("deletion.description")
              : t("discard.description")
          }
          cancelLabel={t("actions.cancel")}
          busy={busy}
          returnFocusRef={returnFocusRef}
          onClose={() => {
            setDialog(null);
            workingCopy.dismissError();
          }}
          actions={
            state.phase === "ended"
              ? [
                  {
                    label: t("actions.close"),
                    onAction: () => {
                      void workingCopy.end("close");
                    },
                  },
                ]
              : [
                  {
                    label:
                      dialog === "delete"
                        ? deleteResult
                          ? t("actions.retry")
                          : t("deletion.confirm")
                        : t("actions.discard"),
                    destructive: true,
                    onAction: () => {
                      if (dialog === "delete") void confirmDeletion();
                      else void workingCopy.end("close", true);
                    },
                  },
                ]
          }
        >
          {dialog === "delete" && state.phase !== "ended" ? (
            <label
              htmlFor="skip-deletion-confirmation"
              className="flex shrink-0 cursor-pointer items-center gap-2 text-xs has-disabled:cursor-not-allowed"
            >
              <Checkbox
                id="skip-deletion-confirmation"
                checked={dontAskAgain}
                disabled={busy}
                onCheckedChange={(checked) => setDontAskAgain(checked === true)}
              />
              {t("deletion.dontAskAgain")}
            </label>
          ) : null}
          {dialog === "delete" && deletionSettingsError ? (
            <p
              role="alert"
              className="shrink-0 break-words text-xs text-destructive"
            >
              {deletionSettingsError}
            </p>
          ) : null}
          {dialog === "delete" && deleteResult?.error ? (
            <p
              className="shrink-0 break-words text-xs text-destructive"
              role="alert"
            >
              {deleteResult.error.kind === "unknown"
                ? t("errors.unknown")
                : state.phase === "ended"
                  ? t(`errors.${deleteResult.error.kind}`)
                  : t("deletion.failed")}
              {"message" in deleteResult.error
                ? ` ${deleteResult.error.message}`
                : ""}
            </p>
          ) : null}
          {dialog === "discard" && state.error ? (
            <p
              className="shrink-0 break-words text-xs text-destructive"
              role="alert"
            >
              {t(`errors.${state.error.kind}`)}
            </p>
          ) : null}
        </AlertDialog>
      </div>
    </main>
  );
}

export default App;
