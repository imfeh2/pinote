import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";
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
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/hooks/useTheme";
import {
  emitNoteContextMenuAction,
  listenNoteContextMenuSync,
  type NoteContextMenuAction,
  type NoteContextMenuContext,
} from "@/lib/contextMenuApi";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/utils";

const MENU_EDGE_GAP = 8;
const MENU_MAX_WIDTH = 360;
const MENU_ACTION_CLASS_NAME =
  "flex h-auto items-center justify-start whitespace-nowrap rounded border-0 px-2 py-1.5 text-left font-normal text-foreground transition-colors hover:text-accent-foreground";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ContextMenuApp({
  targetWindowLabel,
  noteId,
  notePath,
  anchorX,
  anchorY,
  noteOpacity,
  noteReadOnly,
  maximized,
}: NoteContextMenuContext) {
  const { t } = useTranslation("contextMenu");
  useTheme();
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
  const [context, setContext] = useState<NoteContextMenuContext>({
    targetWindowLabel,
    noteId,
    notePath,
    anchorX,
    anchorY,
    noteOpacity,
    noteReadOnly,
    maximized,
  });
  const menuSurfaceOpacity = settings.contextMenuFollowNoteOpacity
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
    [closeMenu, context.targetWindowLabel, menuWindowLabel],
  );

  useEffect(() => {
    let unlistenFocusChanged: (() => void) | null = null;

    menuWindow
      .onFocusChanged(({ payload }) => {
        if (payload) return;
        closeMenu();
      })
      .then((unlisten) => {
        unlistenFocusChanged = unlisten;
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
      if (unlistenFocusChanged) {
        unlistenFocusChanged();
      }
    };
  }, [closeMenu, menuWindow, menuWindowLabel]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listenNoteContextMenuSync((nextContext) => {
      setContext(nextContext);
    })
      .then((handler) => {
        unlisten = handler;
      })
      .catch((error) => {
        logError("context-menu", "subscribe_sync_listener_failed", error, {
          windowId: menuWindowLabel,
        });
      });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [menuWindowLabel]);

  const title = context.noteId;
  const titleShouldScroll = titleScrollDistance > 0;

  const revealNoteFile = useCallback(() => {
    revealItemInDir(context.notePath)
      .catch((error) => {
        logError("context-menu", "reveal_note_file_failed", error, {
          windowId: menuWindowLabel,
          notePath: context.notePath,
        });
      })
      .finally(closeMenu);
  }, [closeMenu, context.notePath, menuWindowLabel]);

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

  const fitWindowToContent = useCallback(
    (menuContext: NoteContextMenuContext) => {
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
      void Promise.all([menuWindow.scaleFactor(), menuWindow.innerSize()])
        .then(async ([scaleFactor, size]) => {
          const factor =
            Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
          const width = Math.max(1, Math.round(widthCss * factor));
          const height = Math.max(1, Math.round(heightCss * factor));
          const pointerX = menuContext.anchorX;
          const pointerY = menuContext.anchorY;
          let nextX = pointerX;
          let nextY = pointerY;
          const monitor = await monitorFromPoint(pointerX, pointerY).catch(
            () => null,
          );
          if (monitor) {
            const minX = monitor.workArea.position.x + MENU_EDGE_GAP;
            const minY = monitor.workArea.position.y + MENU_EDGE_GAP;
            const maxX = Math.max(
              minX,
              monitor.workArea.position.x +
                monitor.workArea.size.width -
                width -
                MENU_EDGE_GAP,
            );
            const maxY = Math.max(
              minY,
              monitor.workArea.position.y +
                monitor.workArea.size.height -
                height -
                MENU_EDGE_GAP,
            );
            const rightSpace =
              monitor.workArea.position.x +
              monitor.workArea.size.width -
              pointerX -
              MENU_EDGE_GAP;
            const leftSpace =
              pointerX - monitor.workArea.position.x - MENU_EDGE_GAP;
            const bottomSpace =
              monitor.workArea.position.y +
              monitor.workArea.size.height -
              pointerY -
              MENU_EDGE_GAP;
            const topSpace =
              pointerY - monitor.workArea.position.y - MENU_EDGE_GAP;
            if (rightSpace < width && leftSpace >= width) {
              nextX = pointerX - width;
            }
            if (bottomSpace < height && topSpace >= height) {
              nextY = pointerY - height;
            }
            nextX = clamp(nextX, minX, maxX);
            nextY = clamp(nextY, minY, maxY);
          }
          const position = await menuWindow.outerPosition().catch(() => null);
          if (!position) {
            await menuWindow.setSize(new PhysicalSize(width, height));
            await menuWindow.setPosition(new PhysicalPosition(nextX, nextY));
            return;
          }
          if (
            size.width === width &&
            size.height === height &&
            nextX === position.x &&
            nextY === position.y
          ) {
            return;
          }
          await menuWindow.setSize(new PhysicalSize(width, height));
          await menuWindow.setPosition(new PhysicalPosition(nextX, nextY));
        })
        .catch((error) => {
          logError("context-menu", "fit_window_to_content_failed", error, {
            windowId: menuWindow.label,
            anchorX: menuContext.anchorX,
            anchorY: menuContext.anchorY,
          });
        });
    },
    [menuWindow, updateTitleOverflow],
  );

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      fitWindowToContent(context);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [context, fitWindowToContent]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      fitWindowToContent(context);
      updateTitleOverflow();
    });
    observer.observe(shell);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
    };
  }, [context, fitWindowToContent, updateTitleOverflow]);

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
                {title}
              </div>
            </div>
          </button>
          <div className="my-1 h-px bg-border" />
          <div ref={actionsRef} className="inline-flex w-max flex-col">
            <Button
              variant="ghost"
              onClick={() => dispatchAction("new-note")}
              className={MENU_ACTION_CLASS_NAME}
            >
              {t("newNote")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => dispatchAction("open-settings")}
              className={MENU_ACTION_CLASS_NAME}
            >
              {t("openSettings")}
            </Button>
            {!settings.hideNoteWindowsFromTaskbar && (
              <Button
                variant="ghost"
                onClick={() => dispatchAction("minimize-window")}
                className={MENU_ACTION_CLASS_NAME}
              >
                {t("minimizeWindow")}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => dispatchAction("toggle-maximize")}
              className={MENU_ACTION_CLASS_NAME}
            >
              {context.maximized ? t("restoreWindow") : t("maximizeWindow")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => dispatchAction("toggle-read-only")}
              className={MENU_ACTION_CLASS_NAME}
            >
              {context.noteReadOnly
                ? t("disableReadOnly")
                : t("enableReadOnly")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => dispatchAction("hide-window")}
              className={MENU_ACTION_CLASS_NAME}
            >
              {t("hideWindow")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => dispatchAction("close-window")}
              className={MENU_ACTION_CLASS_NAME}
            >
              {t("closeWindow")}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                MENU_ACTION_CLASS_NAME,
                "text-red-700 hover:text-red-700 [[data-theme=dark]_&]:text-red-400 [[data-theme=dark]_&]:hover:text-red-400",
              )}
              onClick={() => dispatchAction("delete-note")}
            >
              {t("deleteNote")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContextMenuApp;
