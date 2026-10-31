import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  closeNoteContextMenu,
  openNoteContextMenu,
} from "@/lib/contextMenuApi";
import { logError, logInfo } from "@/lib/logger";

import type { DragMouseButton, WheelResizeModifier } from "@/stores/settings";

const WINDOW_MIN_WIDTH = 1;
const WINDOW_MIN_HEIGHT = 1;
const WINDOW_MAX_WIDTH = 1920;
const WINDOW_MAX_HEIGHT = 2160;
const WINDOW_RESIZE_WIDTH_STEP = 24;
const WINDOW_RESIZE_HEIGHT_STEP = 30;
const NOTE_OPACITY_MIN = 0;
const NOTE_OPACITY_MAX = 1;
const NOTE_OPACITY_STEP = 0.05;
const DRAG_SAMPLE_INTERVAL_MS = 100;

interface DragPosition {
  x: number;
  y: number;
}

interface MiddleDragState {
  button: number;
  allowMove: boolean;
  pointerStartX: number;
  pointerStartY: number;
  pointerCurrentX: number;
  pointerCurrentY: number;
  windowStartX: number;
  windowStartY: number;
  scaleFactor: number;
  moved: boolean;
  ready: boolean;
  startedAt: number;
  lastSampleAt: number;
  inputEvents: number;
  positionRequests: number;
  positionApplied: number;
  coalescedUpdates: number;
  positionErrors: number;
  totalSetPositionMs: number;
  maxSetPositionMs: number;
  lastRequestedPosition: DragPosition | null;
}

interface ModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

interface UseNoteWindowMouseInteractionsOptions {
  appWindow: ReturnType<typeof getCurrentWindow>;
  interactionBlocked: boolean;
  noteId: string;
  notePath: string;
  windowLabel: string;
  dragMouseButton: DragMouseButton;
  wheelOpacityModifier: WheelResizeModifier;
  wheelResizeModifier: WheelResizeModifier;
  noteOpacityRef: MutableRefObject<number>;
  noteReadOnlyRef: MutableRefObject<boolean>;
  noteScrollTopRef: MutableRefObject<number>;
  persistWindowState: (
    visibility?: "visible" | "hidden",
    pushHiddenToTop?: boolean,
    opacity?: number,
    scrollTop?: number,
    readOnly?: boolean,
  ) => Promise<boolean>;
  setNoteOpacityState: (value: number) => void;
  toggleAlwaysOnTop: () => Promise<void> | void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function wheelModifierMatchesEvent(
  event: ModifierState,
  modifier: WheelResizeModifier,
) {
  if (modifier === "alt") {
    return event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;
  }
  if (modifier === "ctrl") {
    return event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  }
  if (modifier === "shift") {
    return event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  }
  return event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

function resolveDragMouseButtonCode(button: DragMouseButton) {
  return button === "right" ? 2 : 1;
}

function consumeMouseEvent(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

export function useNoteWindowMouseInteractions(
  options: UseNoteWindowMouseInteractionsOptions,
) {
  const {
    appWindow,
    interactionBlocked,
    noteId,
    notePath,
    windowLabel,
    dragMouseButton,
    wheelOpacityModifier,
    wheelResizeModifier,
    noteOpacityRef,
    noteReadOnlyRef,
    noteScrollTopRef,
    persistWindowState,
    setNoteOpacityState,
    toggleAlwaysOnTop,
  } = options;
  const wheelResizeLock = useRef(false);
  const middleDragState = useRef<MiddleDragState | null>(null);
  const middleDragPendingPosition = useRef<DragPosition | null>(null);
  const middleDragLastPosition = useRef<DragPosition | null>(null);
  const middleDragPositionInFlight = useRef(false);
  const suppressNextContextMenu = useRef(false);
  const suppressEditorScrollUntilRef = useRef(0);
  const suppressEditorScrollTopRef = useRef(0);

  const closeContextMenu = useCallback(() => {
    void closeNoteContextMenu(windowLabel);
  }, [windowLabel]);

  useEffect(() => {
    if (!interactionBlocked) return;
    middleDragState.current = null;
    middleDragPendingPosition.current = null;
    closeContextMenu();
  }, [closeContextMenu, interactionBlocked]);

  const applyMiddleDragPosition = useCallback(async () => {
    if (middleDragPositionInFlight.current) return;
    middleDragPositionInFlight.current = true;
    try {
      while (middleDragPendingPosition.current) {
        const target = middleDragPendingPosition.current;
        middleDragPendingPosition.current = null;
        const last = middleDragLastPosition.current;
        if (last && last.x === target.x && last.y === target.y) continue;
        const state = middleDragState.current;
        const requestStartedAt = performance.now();
        if (state) state.positionRequests += 1;
        try {
          await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
          middleDragLastPosition.current = target;
          if (state) state.positionApplied += 1;
        } catch (error) {
          if (state) state.positionErrors += 1;
          logError("note-window", "move_window_by_drag_failed", error, {
            windowId: windowLabel,
            target: [target.x, target.y],
          });
        } finally {
          if (state) {
            const duration = performance.now() - requestStartedAt;
            state.totalSetPositionMs += duration;
            state.maxSetPositionMs = Math.max(state.maxSetPositionMs, duration);
          }
        }
      }
    } finally {
      middleDragPositionInFlight.current = false;
    }
  }, [appWindow, windowLabel]);

  const scheduleMiddleDragPosition = useCallback(() => {
    void applyMiddleDragPosition();
  }, [applyMiddleDragPosition]);

  const queueMiddleDragPosition = useCallback(
    (state: MiddleDragState, target: DragPosition) => {
      const pending = middleDragPendingPosition.current;
      if (pending && pending.x === target.x && pending.y === target.y) return;
      if (pending) state.coalescedUpdates += 1;
      state.lastRequestedPosition = target;
      middleDragPendingPosition.current = target;
      scheduleMiddleDragPosition();
    },
    [scheduleMiddleDragPosition],
  );

  useEffect(() => {
    const handleScrollCapture = (event: Event) => {
      if (Date.now() > suppressEditorScrollUntilRef.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains("milkdown-editor")) return;
      const lockedTop = suppressEditorScrollTopRef.current;
      if (Math.abs(target.scrollTop - lockedTop) < 0.5) return;
      target.scrollTop = lockedTop;
    };

    window.addEventListener("scroll", handleScrollCapture, true);
    return () => {
      window.removeEventListener("scroll", handleScrollCapture, true);
    };
  }, []);

  useEffect(() => {
    if (interactionBlocked) return;
    const dragButton = resolveDragMouseButtonCode(dragMouseButton);

    const handleMiddleAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      consumeMouseEvent(event);
    };

    const handlePointerMouseDown = (event: MouseEvent) => {
      const isDragButton = event.button === dragButton;
      const isMiddleToggleButton = event.button === 1;
      if (!isDragButton && !isMiddleToggleButton) return;
      consumeMouseEvent(event);
      closeContextMenu();
      const startedAt = performance.now();
      const nextState: MiddleDragState = {
        button: event.button,
        allowMove: isDragButton,
        pointerStartX: event.screenX,
        pointerStartY: event.screenY,
        pointerCurrentX: event.screenX,
        pointerCurrentY: event.screenY,
        windowStartX: 0,
        windowStartY: 0,
        scaleFactor: 1,
        moved: false,
        ready: false,
        startedAt,
        lastSampleAt: startedAt,
        inputEvents: 0,
        positionRequests: 0,
        positionApplied: 0,
        coalescedUpdates: 0,
        positionErrors: 0,
        totalSetPositionMs: 0,
        maxSetPositionMs: 0,
        lastRequestedPosition: null,
      };
      middleDragState.current = nextState;
      middleDragPendingPosition.current = null;
      middleDragLastPosition.current = null;
      logInfo("note-window", "mouse_drag_down", {
        windowId: windowLabel,
        button: event.button,
        dragButton,
        allowMove: isDragButton,
        screenX: event.screenX,
        screenY: event.screenY,
      });
      Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
        .then(([position, scaleFactor]) => {
          const state = middleDragState.current;
          if (!state) return;
          if (state !== nextState) return;
          state.windowStartX = position.x;
          state.windowStartY = position.y;
          state.scaleFactor = scaleFactor;
          state.ready = true;
          if (!state.allowMove) return;
          const deltaX = state.pointerCurrentX - state.pointerStartX;
          const deltaY = state.pointerCurrentY - state.pointerStartY;
          logInfo("note-window", "mouse_drag_ready", {
            windowId: windowLabel,
            outerPosition: [position.x, position.y],
            scaleFactor,
            delta: [deltaX, deltaY],
          });
          if (deltaX === 0 && deltaY === 0) return;
          queueMiddleDragPosition(state, {
            x: state.windowStartX + Math.round(deltaX * state.scaleFactor),
            y: state.windowStartY + Math.round(deltaY * state.scaleFactor),
          });
        })
        .catch((error) => {
          logError("note-window", "prepare_drag_state_failed", error, {
            windowId: windowLabel,
          });
        });
    };

    window.addEventListener("auxclick", handleMiddleAuxClick, true);
    window.addEventListener("mousedown", handlePointerMouseDown, true);
    return () => {
      window.removeEventListener("auxclick", handleMiddleAuxClick, true);
      window.removeEventListener("mousedown", handlePointerMouseDown, true);
    };
  }, [
    appWindow,
    closeContextMenu,
    interactionBlocked,
    dragMouseButton,
    queueMiddleDragPosition,
    windowLabel,
  ]);

  useEffect(() => {
    if (interactionBlocked) return;
    const suppressContextMenuOnce = () => {
      suppressNextContextMenu.current = true;
      window.setTimeout(() => {
        suppressNextContextMenu.current = false;
      }, 200);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const state = middleDragState.current;
      if (!state) return;
      consumeMouseEvent(event);
      state.inputEvents += 1;
      state.pointerCurrentX = event.screenX;
      state.pointerCurrentY = event.screenY;
      const deltaX = state.pointerCurrentX - state.pointerStartX;
      const deltaY = state.pointerCurrentY - state.pointerStartY;
      if (deltaX === 0 && deltaY === 0) return;
      if (!state.moved && Math.abs(deltaX) + Math.abs(deltaY) >= 3) {
        state.moved = true;
        logInfo("note-window", "mouse_drag_moved", {
          windowId: windowLabel,
          delta: [deltaX, deltaY],
          ready: state.ready,
          scaleFactor: state.scaleFactor,
        });
      }
      if (!state.ready) return;
      if (!state.allowMove) return;
      queueMiddleDragPosition(state, {
        x: state.windowStartX + Math.round(deltaX * state.scaleFactor),
        y: state.windowStartY + Math.round(deltaY * state.scaleFactor),
      });
      const now = performance.now();
      if (now - state.lastSampleAt >= DRAG_SAMPLE_INTERVAL_MS) {
        state.lastSampleAt = now;
        const lastApplied = middleDragLastPosition.current;
        logInfo("note-window", "mouse_drag_sample", {
          windowId: windowLabel,
          elapsedMs: Math.round(now - state.startedAt),
          pointer: [state.pointerCurrentX, state.pointerCurrentY],
          requested: state.lastRequestedPosition
            ? [state.lastRequestedPosition.x, state.lastRequestedPosition.y]
            : null,
          applied: lastApplied ? [lastApplied.x, lastApplied.y] : null,
          positionInFlight: middleDragPositionInFlight.current,
          inputEvents: state.inputEvents,
          positionRequests: state.positionRequests,
          positionApplied: state.positionApplied,
          coalescedUpdates: state.coalescedUpdates,
        });
      }
    };

    const finishMiddleInteraction = (shouldToggleAlwaysOnTop: boolean) => {
      const state = middleDragState.current;
      const pendingPosition = middleDragPendingPosition.current;
      const lastAppliedPosition = middleDragLastPosition.current;
      const positionInFlight = middleDragPositionInFlight.current;
      middleDragState.current = null;
      middleDragPendingPosition.current = null;
      middleDragLastPosition.current = null;
      if (!state) return;
      const completedRequests = state.positionApplied + state.positionErrors;
      logInfo("note-window", "mouse_drag_finished", {
        windowId: windowLabel,
        button: state.button,
        allowMove: state.allowMove,
        moved: state.moved,
        ready: state.ready,
        durationMs: Math.round(performance.now() - state.startedAt),
        pointerStart: [state.pointerStartX, state.pointerStartY],
        pointerEnd: [state.pointerCurrentX, state.pointerCurrentY],
        delta: [
          state.pointerCurrentX - state.pointerStartX,
          state.pointerCurrentY - state.pointerStartY,
        ],
        windowStart: [state.windowStartX, state.windowStartY],
        scaleFactor: state.scaleFactor,
        requested: state.lastRequestedPosition
          ? [state.lastRequestedPosition.x, state.lastRequestedPosition.y]
          : null,
        applied: lastAppliedPosition
          ? [lastAppliedPosition.x, lastAppliedPosition.y]
          : null,
        pending: pendingPosition
          ? [pendingPosition.x, pendingPosition.y]
          : null,
        positionInFlight,
        inputEvents: state.inputEvents,
        positionRequests: state.positionRequests,
        positionApplied: state.positionApplied,
        coalescedUpdates: state.coalescedUpdates,
        positionErrors: state.positionErrors,
        averageSetPositionMs:
          completedRequests > 0
            ? Math.round((state.totalSetPositionMs / completedRequests) * 10) /
              10
            : null,
        maxSetPositionMs: Math.round(state.maxSetPositionMs * 10) / 10,
      });
      if (state.allowMove && state.button === 2) {
        suppressContextMenuOnce();
        if (!state.moved) {
          closeContextMenu();
          void appWindow
            .scaleFactor()
            .then((scaleFactor) => {
              return openNoteContextMenu({
                parentWindowLabel: windowLabel,
                targetWindowLabel: windowLabel,
                noteId,
                notePath,
                screenX: state.pointerCurrentX,
                screenY: state.pointerCurrentY,
                scaleFactor,
                noteOpacity: noteOpacityRef.current,
                noteReadOnly: noteReadOnlyRef.current,
              });
            })
            .catch((error) => {
              logError(
                "note-window",
                "open_context_menu_by_right_click_failed",
                error,
                {
                  windowId: windowLabel,
                },
              );
            });
        }
      }
      if (shouldToggleAlwaysOnTop && state.button === 1 && !state.moved) {
        toggleAlwaysOnTop();
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      const state = middleDragState.current;
      if (!state) return;
      if (event.button !== state.button) return;
      consumeMouseEvent(event);
      finishMiddleInteraction(true);
    };

    const handleBlur = () => {
      finishMiddleInteraction(false);
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    appWindow,
    closeContextMenu,
    interactionBlocked,
    noteId,
    notePath,
    noteOpacityRef,
    noteReadOnlyRef,
    queueMiddleDragPosition,
    toggleAlwaysOnTop,
    windowLabel,
  ]);

  const resizeWindowByWheel = useCallback(
    async (deltaY: number, anchorX: number, anchorY: number) => {
      if (deltaY === 0 || wheelResizeLock.current) return;

      wheelResizeLock.current = true;
      try {
        const direction = deltaY < 0 ? 1 : -1;
        const [size, position] = await Promise.all([
          appWindow.innerSize(),
          appWindow.outerPosition(),
        ]);
        const width = clamp(
          size.width + WINDOW_RESIZE_WIDTH_STEP * direction,
          WINDOW_MIN_WIDTH,
          WINDOW_MAX_WIDTH,
        );
        const height = clamp(
          size.height + WINDOW_RESIZE_HEIGHT_STEP * direction,
          WINDOW_MIN_HEIGHT,
          WINDOW_MAX_HEIGHT,
        );
        if (width === size.width && height === size.height) return;
        const viewportWidth = Math.max(window.innerWidth, 1);
        const viewportHeight = Math.max(window.innerHeight, 1);
        const anchorRatioX = clamp(anchorX / viewportWidth, 0, 1);
        const anchorRatioY = clamp(anchorY / viewportHeight, 0, 1);
        const nextX = Math.round(
          position.x + (size.width - width) * anchorRatioX,
        );
        const nextY = Math.round(
          position.y + (size.height - height) * anchorRatioY,
        );
        await appWindow.setSize(new PhysicalSize(width, height));
        await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
        logInfo("note-window", "window_resized_by_wheel", {
          windowId: windowLabel,
          size: [width, height],
          position: [nextX, nextY],
        });
      } catch (error) {
        logError("note-window", "resize_window_by_wheel_failed", error, {
          windowId: windowLabel,
        });
      } finally {
        window.setTimeout(() => {
          wheelResizeLock.current = false;
        }, 16);
      }
    },
    [appWindow, windowLabel],
  );

  const adjustOpacityByWheel = useCallback(
    (deltaY: number) => {
      if (deltaY === 0) return;
      const direction = deltaY < 0 ? 1 : -1;
      const nextOpacity = clamp(
        noteOpacityRef.current + NOTE_OPACITY_STEP * direction,
        NOTE_OPACITY_MIN,
        NOTE_OPACITY_MAX,
      );
      if (nextOpacity === noteOpacityRef.current) return;
      noteOpacityRef.current = nextOpacity;
      setNoteOpacityState(nextOpacity);
      logInfo("note-window", "opacity_adjusted", {
        windowId: windowLabel,
        next: nextOpacity,
      });
      void persistWindowState(undefined, false, nextOpacity);
    },
    [noteOpacityRef, persistWindowState, setNoteOpacityState, windowLabel],
  );

  useEffect(() => {
    if (interactionBlocked) return;
    const handleWindowWheel = (event: WheelEvent) => {
      const consumeWheelEvent = () => {
        const editor =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>(".milkdown-editor")
            : document.querySelector<HTMLElement>(".milkdown-editor");
        suppressEditorScrollTopRef.current =
          editor?.scrollTop ?? noteScrollTopRef.current;
        suppressEditorScrollUntilRef.current = Date.now() + 140;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      };

      if (wheelModifierMatchesEvent(event, wheelOpacityModifier)) {
        consumeWheelEvent();
        closeContextMenu();
        adjustOpacityByWheel(event.deltaY);
        return;
      }
      if (!wheelModifierMatchesEvent(event, wheelResizeModifier)) return;
      consumeWheelEvent();
      closeContextMenu();
      void resizeWindowByWheel(event.deltaY, event.clientX, event.clientY);
    };

    window.addEventListener("wheel", handleWindowWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener("wheel", handleWindowWheel, {
        capture: true,
      });
    };
  }, [
    adjustOpacityByWheel,
    closeContextMenu,
    interactionBlocked,
    noteScrollTopRef,
    resizeWindowByWheel,
    wheelOpacityModifier,
    wheelResizeModifier,
  ]);

  useEffect(() => {
    if (
      interactionBlocked ||
      (wheelResizeModifier !== "alt" && wheelOpacityModifier !== "alt")
    ) {
      return;
    }

    const suppressBareAlt = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      if (event.ctrlKey || event.shiftKey || event.metaKey) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", suppressBareAlt, true);
    window.addEventListener("keyup", suppressBareAlt, true);
    return () => {
      window.removeEventListener("keydown", suppressBareAlt, true);
      window.removeEventListener("keyup", suppressBareAlt, true);
    };
  }, [interactionBlocked, wheelOpacityModifier, wheelResizeModifier]);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (interactionBlocked) {
        event.preventDefault();
        return;
      }
      if (suppressNextContextMenu.current) {
        suppressNextContextMenu.current = false;
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const screenX = event.screenX;
      const screenY = event.screenY;
      void appWindow
        .scaleFactor()
        .then((scaleFactor) => {
          return openNoteContextMenu({
            parentWindowLabel: windowLabel,
            targetWindowLabel: windowLabel,
            noteId,
            notePath,
            screenX,
            screenY,
            scaleFactor,
            noteOpacity: noteOpacityRef.current,
            noteReadOnly: noteReadOnlyRef.current,
          });
        })
        .catch((error) => {
          logError("note-window", "open_context_menu_window_failed", error, {
            windowId: windowLabel,
            noteId,
          });
        });
    },
    [
      appWindow,
      interactionBlocked,
      noteId,
      noteOpacityRef,
      notePath,
      noteReadOnlyRef,
      windowLabel,
    ],
  );

  return {
    openContextMenu,
  };
}
