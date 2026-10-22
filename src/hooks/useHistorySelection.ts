import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { NoteHistorySearchResult } from "@/lib/noteHistory";

interface SelectionDrag {
  pointerId: number;
  x: number;
  y: number;
  checked: boolean;
  lastIndex: number | null;
  visited: Set<number>;
  paths: string[];
}

export function useHistorySelection(
  results: NoteHistorySearchResult[],
  disabled: boolean,
) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLElement>(null);
  const dragRef = useRef<SelectionDrag | null>(null);
  const frameRef = useRef<number | null>(null);
  const ignoreClickRef = useRef(false);

  const stopDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (drag && listRef.current?.hasPointerCapture(drag.pointerId)) {
      listRef.current.releasePointerCapture(drag.pointerId);
    }
  }, []);

  useEffect(() => {
    const drag = dragRef.current;
    if (
      disabled ||
      (drag &&
        (drag.paths.length !== results.length ||
          drag.paths.some((path, index) => path !== results[index]?.notePath)))
    )
      stopDrag();
  }, [results, disabled, stopDrag]);

  useEffect(() => {
    window.addEventListener("blur", stopDrag);
    return () => {
      stopDrag();
      window.removeEventListener("blur", stopDrag);
    };
  }, [stopDrag]);

  const setPathsChecked = useCallback((paths: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      let changed = false;
      for (const path of paths) {
        if (next.has(path) === checked) continue;
        changed = true;
        if (checked) next.add(path);
        else next.delete(path);
      }
      return changed ? next : current;
    });
  }, []);

  const paint = useCallback(
    (index: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const previous = drag.lastIndex ?? index;
      const paths: string[] = [];
      for (
        let item = Math.min(previous, index);
        item <= Math.max(previous, index);
        item += 1
      ) {
        if (drag.visited.has(item)) continue;
        const path = drag.paths[item];
        if (path === undefined) continue;
        drag.visited.add(item);
        paths.push(path);
      }
      drag.lastIndex = index;
      if (paths.length > 0) setPathsChecked(paths, drag.checked);
    },
    [setPathsChecked],
  );

  const paintAtPointer = useCallback(() => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;
    const bounds = list.getBoundingClientRect();
    const y = Math.max(bounds.top + 2, Math.min(bounds.bottom - 2, drag.y));
    const target = document
      .elementFromPoint(drag.x, y)
      ?.closest<HTMLElement>("[data-history-index]");
    if (target && list.contains(target))
      paint(Number(target.dataset.historyIndex));
    else drag.lastIndex = null;
  }, [paint]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    ignoreClickRef.current = false;
    if (disabled || event.button !== 0 || event.pointerType === "touch") return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-history-select]",
    );
    if (!target || !event.currentTarget.contains(target)) return;
    const index = Number(
      target.closest<HTMLElement>("[data-history-index]")?.dataset.historyIndex,
    );
    const path = results[index]?.notePath;
    if (path === undefined) return;
    event.preventDefault();
    ignoreClickRef.current = true;
    stopDrag();
    target.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      checked: !selected.has(path),
      lastIndex: index,
      visited: new Set(),
      paths: results.map((item) => item.notePath),
    };
    paint(index);
    let lastFrame = performance.now();
    const scroll = (now: number) => {
      const drag = dragRef.current;
      const list = listRef.current;
      if (!drag || !list) return;
      const bounds = list.getBoundingClientRect();
      const edge = 32;
      const direction =
        drag.y < bounds.top + edge ? -1 : drag.y > bounds.bottom - edge ? 1 : 0;
      if (direction && drag.x >= bounds.left && drag.x <= bounds.right) {
        list.scrollTop += direction * Math.min(now - lastFrame, 32) * 0.5;
        paintAtPointer();
      }
      lastFrame = now;
      frameRef.current = requestAnimationFrame(scroll);
    };
    frameRef.current = requestAnimationFrame(scroll);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      stopDrag();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    paintAtPointer();
  };

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (ignoreClickRef.current && event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    ignoreClickRef.current = false;
  };

  return {
    selected,
    setSelected,
    setPathsChecked,
    listRef,
    onPointerDown,
    onPointerMove,
    onClickCapture,
    stopDrag,
  };
}
