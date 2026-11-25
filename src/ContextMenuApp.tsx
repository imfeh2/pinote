import { PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { useInterfaceFont } from "@/hooks/useInterfaceFont";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import {
  emitNoteContextMenuAction,
  listenNoteContextMenuSync,
  type NoteContextMenuAction,
  type NoteContextMenuContext,
  showNoteContextMenu,
} from "@/lib/contextMenuApi";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/utils";

const MENU_MAX_WIDTH = 360;
const MENU_ACTION_CLASS_NAME =
  "flex h-auto items-center justify-start whitespace-nowrap rounded border-0 px-2 py-1.5 text-left font-normal text-foreground transition-colors hover:text-accent-foreground";

const staticActionLabelKeys = {
  "new-note": "newNote",
  "open-settings": "openSettings",
  "minimize-window": "minimizeWindow",
  "toggle-theme": "toggleTheme",
  "show-all-hidden-windows": "showAllHiddenWindows",
  "hide-window": "hideWindow",
  "close-window": "closeWindow",
  "delete-note": "deleteNote",
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ContextMenuApp() {
  const { t } = useTranslation("contextMenu");
  useTheme();
  useInterfaceFont();
  const { settings } = useSettings();
  const menuWindow = useMemo(() => getCurrentWindow(), []);
  const menuWindowLabel = menuWindow.label;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const titleViewportRef = useRef<HTMLDivElement | null>(null);
  const titleTextRef = useRef<HTMLDivElement | null>(null);
  const [titleScrollDistance, setTitleScrollDistance] = useState(0);
  const [titleScrollDuration, setTitleScrollDuration] = useState(0);
  const appliedSizeRef = useRef<{ width: number; height: number } | null>(null);
  const resizingRef = useRef<Promise<void>>(Promise.resolve());
  const [context, setContext] = useState<NoteContextMenuContext | null>(null);
  const menuSurfaceOpacity =
    settings.contextMenuFollowNoteOpacity && context
      ? clamp(context.noteOpacity, 0.2, 1)
      : 1;
  const menuVisualStyle = useMemo(
    () =>
      ({
        opacity: menuSurfaceOpacity,
      }) as CSSProperties,
    [menuSurfaceOpacity],
  );

  const closeMenu = useCallback(() => {
    menuWindow.hide().catch(() => {});
  }, [menuWindow]);

  const dispatchAction = useCallback(
    (action: NoteContextMenuAction) => {
      if (!context) return;
      emitNoteContextMenuAction(context.targetWindowLabel, action)
        .catch((error) => {
          logError("context-menu", "emit_action_failed", error, {
            windowId: menuWindowLabel,
            targetWindowLabel: context.targetWindowLabel,
            action,
          });
        })
        .finally(() => {
          closeMenu();
        });
    },
    [closeMenu, context, menuWindowLabel],
  );

  useEffect(() => {
    const focusSubscription = menuWindow
      .onFocusChanged(({ payload }) => {
        if (payload) return;
        closeMenu();
      })
      .catch((error) => {
        logError("context-menu", "subscribe_focus_listener_failed", error, {
          windowId: menuWindowLabel,
        });
      });

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
    };

    const suppressNativeMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("contextmenu", suppressNativeMenu, true);
    return () => {
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("contextmenu", suppressNativeMenu, true);
      void focusSubscription.then((unlisten) => unlisten?.());
    };
  }, [closeMenu, menuWindow, menuWindowLabel]);

  useEffect(() => {
    const syncSubscription = listenNoteContextMenuSync((nextContext) => {
      flushSync(() => setContext(nextContext));
      resizingRef.current.then(showNoteContextMenu).catch((error) => {
        logError("context-menu", "show_menu_failed", error, {
          windowId: menuWindowLabel,
          targetWindowLabel: nextContext.targetWindowLabel,
        });
      });
    }).catch((error) => {
      logError("context-menu", "subscribe_sync_listener_failed", error, {
        windowId: menuWindowLabel,
      });
    });
    return () => {
      void syncSubscription.then((unlisten) => unlisten?.());
    };
  }, [menuWindowLabel]);

  const menuActions = useMemo(
    () =>
      settings.contextMenuItems
        .filter(
          (item) =>
            item.visible &&
            !(
              item.action === "minimize-window" &&
              settings.hideNoteWindowsFromTaskbar
            ),
        )
        .map((item) => item.action),
    [settings.contextMenuItems, settings.hideNoteWindowsFromTaskbar],
  );

  const actionLabels = (action: NoteContextMenuAction): string[] => {
    const toggle = (on: boolean, onLabel: string, offLabel: string) =>
      on ? [onLabel, offLabel] : [offLabel, onLabel];
    if (action === "toggle-maximize") {
      return toggle(
        context?.maximized ?? false,
        t("restoreWindow"),
        t("maximizeWindow"),
      );
    }
    if (action === "toggle-always-on-top") {
      return toggle(
        context?.alwaysOnTop ?? false,
        t("disableAlwaysOnTop"),
        t("enableAlwaysOnTop"),
      );
    }
    if (action === "toggle-read-only") {
      return toggle(
        context?.noteReadOnly ?? false,
        t("disableReadOnly"),
        t("enableReadOnly"),
      );
    }
    return [t(staticActionLabelKeys[action])];
  };

  const title = context?.noteId ?? "";
  const titleShouldScroll = titleScrollDistance > 0;

  const revealNoteFile = useCallback(() => {
    if (!context) return;
    revealItemInDir(context.notePath)
      .catch((error) => {
        logError("context-menu", "reveal_note_file_failed", error, {
          windowId: menuWindowLabel,
          notePath: context.notePath,
        });
      })
      .finally(closeMenu);
  }, [closeMenu, context, menuWindowLabel]);

  const updateTitleOverflow = useCallback(() => {
    const viewport = titleViewportRef.current;
    const text = titleTextRef.current;
    if (!viewport || !text) return;
    const distance = Math.max(
      0,
      Math.ceil(text.scrollWidth - viewport.clientWidth),
    );
    const nextDistance = distance > 2 ? distance : 0;
    const nextDuration =
      nextDistance > 0 ? clamp((nextDistance + 56) / 34, 3.6, 18) : 0;
    setTitleScrollDistance((prev) =>
      prev === nextDistance ? prev : nextDistance,
    );
    setTitleScrollDuration((prev) =>
      Math.abs(prev - nextDuration) < 0.001 ? prev : nextDuration,
    );
  }, []);

  const titleStyle = useMemo(
    () =>
      ({
        "--pinote-menu-title-distance": `${titleScrollDistance}px`,
        "--pinote-menu-title-duration": `${titleScrollDuration}s`,
      }) as CSSProperties,
    [titleScrollDistance, titleScrollDuration],
  );

  const fitWindowToContent = useCallback(() => {
    const shell = shellRef.current;
    const panel = panelRef.current;
    const actions = actionsRef.current;
    if (!shell || !panel || !actions) return;
    const shellStyles = window.getComputedStyle(shell);
    const panelStyles = window.getComputedStyle(panel);
    const shellPaddingX =
      parsePx(shellStyles.paddingLeft) + parsePx(shellStyles.paddingRight);
    const panelPaddingX =
      parsePx(panelStyles.paddingLeft) +
      parsePx(panelStyles.paddingRight) +
      parsePx(panelStyles.borderLeftWidth) +
      parsePx(panelStyles.borderRightWidth);
    const actionsRect = actions.getBoundingClientRect();
    const widthCss = clamp(
      Math.ceil(actionsRect.width + shellPaddingX + panelPaddingX),
      1,
      MENU_MAX_WIDTH,
    );
    const panelWidthCss = Math.max(1, widthCss - shellPaddingX);
    const panelWidthValue = `${panelWidthCss}px`;
    if (panel.style.width !== panelWidthValue) {
      panel.style.width = panelWidthValue;
    }
    updateTitleOverflow();
    const heightCss = Math.ceil(
      panel.scrollHeight +
        parsePx(panelStyles.borderTopWidth) +
        parsePx(panelStyles.borderBottomWidth) +
        parsePx(shellStyles.paddingTop) +
        parsePx(shellStyles.paddingBottom),
    );
    const width = Math.ceil(widthCss * window.devicePixelRatio);
    const height = Math.ceil(heightCss * window.devicePixelRatio);
    const applied = appliedSizeRef.current;
    if (applied && applied.width === width && applied.height === height) {
      return;
    }
    appliedSizeRef.current = { width, height };
    resizingRef.current = menuWindow
      .setSize(new PhysicalSize(width, height))
      .catch((error) => {
        logError("context-menu", "fit_window_to_content_failed", error, {
          windowId: menuWindow.label,
          width,
          height,
        });
      });
  }, [menuWindow, updateTitleOverflow]);

  useLayoutEffect(() => {
    fitWindowToContent();
  });

  useEffect(() => {
    let query: MediaQueryList;
    const watch = () => {
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener("change", handleChange, { once: true });
    };
    const handleChange = () => {
      fitWindowToContent();
      watch();
    };
    watch();
    return () => query.removeEventListener("change", handleChange);
  }, [fitWindowToContent]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      fitWindowToContent();
      updateTitleOverflow();
    });
    observer.observe(shell);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
    };
  }, [fitWindowToContent, updateTitleOverflow]);

  useEffect(() => {
    const viewport = titleViewportRef.current;
    const text = titleTextRef.current;
    if (!viewport || !text) return;
    const frame = window.requestAnimationFrame(updateTitleOverflow);
    const sizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(updateTitleOverflow)
        : null;
    sizeObserver?.observe(viewport);
    sizeObserver?.observe(text);
    return () => {
      window.cancelAnimationFrame(frame);
      sizeObserver?.disconnect();
    };
  }, [updateTitleOverflow]);

  return (
    <div ref={shellRef} className="inline-block">
      <div
        ref={panelRef}
        className="pinote-context-menu-panel relative max-w-full rounded-lg border border-transparent bg-transparent p-1 shadow-none"
      >
        <div
          style={menuVisualStyle}
          className="pointer-events-none absolute inset-0 rounded-[inherit] border border-border bg-background shadow-lg"
        />
        <div ref={contentRef} className="relative">
          <button
            type="button"
            onClick={revealNoteFile}
            aria-label={t("showInFolder", { note: title })}
            title={t("showInFolder", { note: title })}
            className="block w-full rounded text-left transition-colors hover:bg-accent"
          >
            <div ref={titleViewportRef} className="pinote-menu-title-viewport">
              <div
                ref={titleTextRef}
                style={titleStyle}
                className={cn(
                  "pinote-menu-title-text px-2 py-1 text-[11px] font-medium text-muted-foreground",
                  titleShouldScroll
                    ? "pinote-menu-title-text-scroll"
                    : "truncate",
                )}
              >
                {title || "\u00a0"}
              </div>
            </div>
          </button>
          {menuActions.length > 0 && <div className="my-1 h-px bg-border" />}
          <div ref={actionsRef} className="inline-flex w-max flex-col">
            {menuActions.map((action) => {
              const [label, alternative] = actionLabels(action);
              return (
                <Button
                  key={action}
                  variant="ghost"
                  onClick={() => dispatchAction(action)}
                  className={cn(
                    MENU_ACTION_CLASS_NAME,
                    action === "delete-note" &&
                      "text-red-700 hover:text-red-700 [[data-theme=dark]_&]:text-red-400 [[data-theme=dark]_&]:hover:text-red-400",
                  )}
                >
                  <span
                    data-alternative={alternative}
                    className="inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:content-[attr(data-alternative)]"
                  >
                    {label}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContextMenuApp;
