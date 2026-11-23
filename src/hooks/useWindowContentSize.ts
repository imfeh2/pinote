import type { PhysicalSize } from "@tauri-apps/api/dpi";
import type { Window } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { logError } from "@/lib/logger";

export function useWindowContentSize(appWindow: Window) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    let disposed = false;
    let physical: PhysicalSize | null = null;
    const apply = () => {
      if (disposed || !physical) return;
      const { width, height } = physical;
      setSize({
        width: width / window.devicePixelRatio,
        height: height / window.devicePixelRatio,
      });
    };
    const read = () => {
      appWindow
        .innerSize()
        .then((next) => {
          physical = next;
          apply();
        })
        .catch((error) => {
          logError("note-window", "read_content_size_failed", error, {
            windowId: appWindow.label,
          });
        });
    };
    let query: MediaQueryList;
    const handleScaleChange = () => {
      apply();
      watchScale();
    };
    const watchScale = () => {
      query = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      query.addEventListener("change", handleScaleChange, { once: true });
    };
    const resized = appWindow
      .onResized(({ payload }) => {
        physical = payload;
        apply();
      })
      .catch((error) => {
        logError("note-window", "listen_resize_failed", error, {
          windowId: appWindow.label,
        });
      });
    read();
    watchScale();
    return () => {
      disposed = true;
      query.removeEventListener("change", handleScaleChange);
      void resized.then((unlisten) => unlisten?.());
    };
  }, [appWindow]);

  return size;
}
