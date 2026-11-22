import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const columns = {
  2: "grid-cols-2",
  3: "grid-cols-3",
} as const;

function contentWidth(cell: Element) {
  const children = Array.from(cell.children);
  const gap = Number.parseFloat(getComputedStyle(cell).columnGap) || 0;
  return (
    children.reduce(
      (width, child) => width + child.getBoundingClientRect().width,
      0,
    ) +
    gap * Math.max(0, children.length - 1)
  );
}

export function SettingsFieldRow({
  count,
  children,
}: {
  count: keyof typeof columns;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [stacked, setStacked] = useState(false);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const update = () => {
      const cells = Array.from(grid.children);
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
      const widest = Math.max(...cells.map(contentWidth));
      setStacked(
        widest * cells.length + gap * (cells.length - 1) > grid.clientWidth,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    for (const cell of Array.from(grid.children)) {
      for (const child of Array.from(cell.children)) observer.observe(child);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "grid gap-x-6 gap-y-3 [&>*>:first-child]:whitespace-nowrap",
        stacked ? "grid-cols-1" : columns[count],
      )}
    >
      {children}
    </div>
  );
}
