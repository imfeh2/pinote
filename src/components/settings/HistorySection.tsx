import {
  defaultValueCtx,
  editorViewOptionsCtx,
  Editor as MilkdownEditorCore,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { ListX, LoaderCircle, Trash2 } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/AlertDialog";
import { Checkbox } from "@/components/Checkbox";
import { useHistorySelection } from "@/hooks/useHistorySelection";
import {
  deleteHistoryNotes,
  type NoteDeleteFailure,
  type NoteHistorySearchResult,
  removeHistoryRecords,
} from "@/lib/noteHistory";
import { cn } from "@/lib/utils";
import type { EditorFontFamily } from "@/stores/settings";

const PREVIEW_DELAY_MS = 300;
const PREVIEW_HIDE_DELAY_MS = 200;
const HISTORY_BATCH_SIZE = 40;

function resolveEditorFontFamily(value: EditorFontFamily) {
  if (value === "serif") {
    return 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
  }
  if (value === "mono") {
    return '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  }
  return "system-ui, -apple-system, sans-serif";
}

interface PreviewState {
  x: number;
  y: number;
  notePath: string;
  content: string;
}

function NotePreview({ markdown }: { markdown: string }) {
  useEditor(
    (root) =>
      MilkdownEditorCore.make()
        .config(nord)
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdown);
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => false,
          }));
        })
        .use(commonmark)
        .use(gfm),
    [],
  );
  return <Milkdown />;
}

function splitPath(path: string) {
  const separator = path.includes("\\") ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  if (index < 0) return { dir: "", file: path };
  return { dir: path.slice(0, index + 1), file: path.slice(index + 1) };
}

interface HistorySectionProps {
  historyQuery: string;
  historyLoading: boolean;
  historyResults: NoteHistorySearchResult[];
  historyTotal: number;
  historyOpeningPath: string | null;
  historyError: string | null;
  setHistoryQuery: (value: string) => void;
  onOpenHistoryItem: (item: NoteHistorySearchResult) => Promise<void>;
  onDeleted: (paths: string[]) => void;
  formatDateTime: (value: string) => string;
  editorFontFamily: EditorFontFamily;
  editorFontSize: number;
  editorLineHeight: number;
}

export function HistorySection({
  historyQuery,
  historyLoading,
  historyResults,
  historyTotal,
  historyOpeningPath,
  historyError,
  setHistoryQuery,
  onOpenHistoryItem,
  onDeleted,
  formatDateTime,
  editorFontFamily,
  editorFontSize,
  editorLineHeight,
}: HistorySectionProps) {
  const { t } = useTranslation("settings");
  const searchRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletePaths, setDeletePaths] = useState<string[] | null>(null);
  const [deleteFailures, setDeleteFailures] = useState<NoteDeleteFailure[]>([]);
  const selection = useHistorySelection(
    historyResults,
    historyLoading || deleting || deletePaths !== null,
  );
  const { selected, setSelected, setPathsChecked, listRef } = selection;
  const [visible, setVisible] = useState({
    results: historyResults,
    count: HISTORY_BATCH_SIZE,
  });
  const visibleCount =
    visible.results === historyResults ? visible.count : HISTORY_BATCH_SIZE;
  const resultPaths = historyResults.map((item) => item.notePath);
  const selectedInResults = resultPaths.filter((path) =>
    selected.has(path),
  ).length;
  const allChecked =
    resultPaths.length > 0 && selectedInResults === resultPaths.length;
  const loadMore = useCallback(() => {
    const list = listRef.current;
    if (!list || historyLoading || visibleCount >= historyResults.length)
      return;
    if (
      list.clientHeight > 0 &&
      list.scrollHeight - list.scrollTop - list.clientHeight < 120
    ) {
      setVisible({
        results: historyResults,
        count: visibleCount + HISTORY_BATCH_SIZE,
      });
    }
  }, [historyResults, historyLoading, visibleCount, listRef]);
  useEffect(() => {
    loadMore();
    window.addEventListener("resize", loadMore);
    return () => window.removeEventListener("resize", loadMore);
  }, [loadMore]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewId = useId();
  const previewRequestRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCacheRef = useRef(new Map<string, string>());
  const titleViewportRef = useRef<HTMLDivElement | null>(null);
  const titleTextRef = useRef<HTMLDivElement | null>(null);
  const [titleScrollDistance, setTitleScrollDistance] = useState(0);
  const [titleScrollDuration, setTitleScrollDuration] = useState(0);

  useEffect(() => {
    return () => {
      previewRequestRef.current += 1;
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const notePath = preview?.notePath;
    if (!notePath) {
      setTitleScrollDistance(0);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const viewport = titleViewportRef.current;
      const text = titleTextRef.current;
      if (!viewport || !text) return;
      const distance = Math.max(
        0,
        Math.ceil(text.scrollWidth - viewport.clientWidth),
      );
      const nextDistance = distance > 2 ? distance : 0;
      const nextDuration =
        nextDistance > 0
          ? Math.min(18, Math.max(3.6, (nextDistance + 56) / 34))
          : 0;
      setTitleScrollDistance(nextDistance);
      setTitleScrollDuration(nextDuration);
    });
    return () => cancelAnimationFrame(raf);
  }, [preview?.notePath]);

  const schedulePreview = (
    item: NoteHistorySearchResult,
    x: number,
    y: number,
  ) => {
    const request = ++previewRequestRef.current;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      const cached = previewCacheRef.current.get(item.notePath);
      if (cached !== undefined) {
        if (cached)
          setPreview({ x, y, notePath: item.notePath, content: cached });
        return;
      }
      readTextFile(item.notePath)
        .then((content) => {
          previewCacheRef.current.set(item.notePath, content);
          if (request !== previewRequestRef.current) return;
          if (content) setPreview({ x, y, notePath: item.notePath, content });
        })
        .catch(() => {});
    }, PREVIEW_DELAY_MS);
  };

  const cancelPreview = () => {
    previewRequestRef.current += 1;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(
      () => setPreview(null),
      PREVIEW_HIDE_DELAY_MS,
    );
  };

  const handleDelete = async (deleteFiles: boolean) => {
    if (!deletePaths || deleting) return;
    setDeleting(true);
    previewRequestRef.current += 1;
    setPreview(null);
    try {
      const remove = deleteFiles ? deleteHistoryNotes : removeHistoryRecords;
      const { deleted, failures } = await remove(deletePaths);
      setPathsChecked(deleted, false);
      for (const path of deleted) previewCacheRef.current.delete(path);
      onDeleted(deleted);
      setDeleteFailures(failures);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setDeleteFailures(deletePaths.map((notePath) => ({ notePath, reason })));
    } finally {
      setDeleting(false);
      setDeletePaths(null);
    }
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    cancelPreview();
    setPreview(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <Checkbox
          aria-label={t("history.selectAll")}
          title={t("history.selectAll")}
          checked={
            allChecked ? true : selectedInResults > 0 ? "indeterminate" : false
          }
          disabled={historyLoading || deleting || resultPaths.length === 0}
          onCheckedChange={() => setPathsChecked(resultPaths, !allChecked)}
          className="h-8 w-9"
        />
        <input
          ref={searchRef}
          aria-label={t("history.searchPlaceholder")}
          type="text"
          value={historyQuery}
          onChange={(event) => setHistoryQuery(event.target.value)}
          placeholder={t("history.searchPlaceholder")}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary"
        />
        <span
          className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {selected.size}/{historyTotal}
        </span>
        <button
          type="button"
          aria-label={t("history.clearSelection")}
          title={t("history.clearSelection")}
          disabled={selected.size === 0 || deleting}
          onClick={() => setSelected(new Set())}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
        >
          <ListX size={16} />
        </button>
        <button
          type="button"
          aria-label={t("history.delete")}
          title={t("history.delete")}
          disabled={
            selected.size === 0 || deleting || historyOpeningPath !== null
          }
          onClick={() => {
            cancelPreview();
            setPreview(null);
            setDeletePaths([...selected]);
          }}
          className="flex size-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
        >
          {deleting ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Trash2 size={16} />
          )}
        </button>
      </div>
      <section
        ref={listRef}
        aria-label={t("sections.history.label")}
        className="pinote-scrollbar min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background/70"
        onScroll={() => {
          cancelPreview();
          loadMore();
        }}
        onPointerDown={selection.onPointerDown}
        onPointerMove={selection.onPointerMove}
        onPointerUp={selection.stopDrag}
        onPointerCancel={selection.stopDrag}
        onLostPointerCapture={selection.stopDrag}
        onClickCapture={selection.onClickCapture}
      >
        {historyLoading ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("history.searching")}
          </div>
        ) : historyResults.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("history.noResults")}
          </div>
        ) : (
          historyResults.slice(0, visibleCount).map((item, index) => {
            const key = `${item.notePath}::${item.windowId}`;
            const opening = historyOpeningPath === item.notePath;
            const checked = selected.has(item.notePath);
            const { dir, file } = splitPath(item.notePath);
            return (
              <div
                key={key}
                data-history-index={index}
                className={cn(
                  "flex border-b border-border/70 transition-colors last:border-b-0",
                  checked ? "bg-selection" : "hover:bg-accent",
                )}
              >
                <Checkbox
                  data-history-select
                  aria-label={t("history.selectNote", { path: item.notePath })}
                  checked={checked}
                  disabled={deleting}
                  onCheckedChange={(checked) =>
                    setPathsChecked([item.notePath], checked === true)
                  }
                  className="h-auto w-9 self-stretch rounded-none touch-none hover:bg-transparent"
                />
                <button
                  type="button"
                  data-history-open={item.notePath}
                  disabled={opening || deleting}
                  aria-describedby={
                    preview?.notePath === item.notePath ? previewId : undefined
                  }
                  onFocus={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    schedulePreview(item, bounds.left, bounds.bottom);
                  }}
                  onBlur={cancelPreview}
                  onKeyDown={handlePreviewKeyDown}
                  onMouseEnter={(event) => {
                    schedulePreview(item, event.clientX, event.clientY);
                  }}
                  onMouseLeave={(event) => {
                    if (event.currentTarget !== document.activeElement)
                      cancelPreview();
                  }}
                  onClick={() => {
                    void onOpenHistoryItem(item);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col gap-1 px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary",
                    opening && "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-baseline">
                      <span
                        className="min-w-0 truncate text-xs text-muted-foreground/80"
                        title={item.notePath}
                      >
                        {dir}
                      </span>
                      <span
                        className="shrink-0 truncate text-xs text-foreground"
                        title={item.notePath}
                      >
                        {file}
                      </span>
                    </div>
                    {item.matchedByContent && (
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t("history.contentMatch")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t("history.lastOpened", {
                      date: formatDateTime(item.lastOpenedAt),
                    })}
                  </div>
                </button>
              </div>
            );
          })
        )}
      </section>
      <AlertDialog
        open={deletePaths !== null}
        title={t("history.deleteTitle", { count: deletePaths?.length ?? 0 })}
        description={t("history.deleteDescription")}
        cancelLabel={t("history.cancel")}
        actions={[
          {
            label: t("history.removeRecords"),
            onAction: () => void handleDelete(false),
          },
          {
            label: t("history.deleteFiles"),
            destructive: true,
            onAction: () => void handleDelete(true),
          },
        ]}
        busy={deleting}
        returnFocusRef={searchRef}
        onClose={() => setDeletePaths(null)}
      />
      <AlertDialog
        open={deleteFailures.length > 0}
        title={t("history.deleteFailed")}
        description={t("history.deleteFailedDescription")}
        cancelLabel={t("history.close")}
        returnFocusRef={searchRef}
        onClose={() => setDeleteFailures([])}
      >
        <ul className="pinote-scrollbar min-h-0 overflow-y-auto rounded-md border border-border text-xs">
          {deleteFailures.map(({ notePath, reason }) => (
            <li
              key={notePath}
              className="space-y-1 break-all border-b border-border px-3 py-2 last:border-0"
            >
              <div>{notePath}</div>
              <div className="text-destructive">{reason}</div>
            </li>
          ))}
        </ul>
      </AlertDialog>
      {preview &&
        createPortal(
          <aside
            id={previewId}
            aria-label="Note preview"
            className="fixed z-50"
            style={{ left: preview.x + 14, top: preview.y + 14 }}
            onMouseEnter={() => {
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            }}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement))
                cancelPreview();
            }}
            onFocus={() => {
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            }}
            onBlur={cancelPreview}
            onKeyDown={handlePreviewKeyDown}
          >
            <div className="max-w-xs overflow-hidden rounded-md border border-border bg-background shadow-lg">
              <div className="border-b border-border/70 px-2.5 py-1.5">
                <div
                  ref={titleViewportRef}
                  className="pinote-menu-title-viewport"
                >
                  <div
                    ref={titleTextRef}
                    className={cn(
                      "pinote-menu-title-text text-[10px] text-muted-foreground",
                      titleScrollDistance > 0 &&
                        "pinote-menu-title-text-scroll",
                    )}
                    style={
                      {
                        "--pinote-menu-title-distance": `${titleScrollDistance}px`,
                        "--pinote-menu-title-duration": `${titleScrollDuration}s`,
                      } as CSSProperties
                    }
                  >
                    {preview.notePath}
                  </div>
                </div>
              </div>
              <div
                className="milkdown-editor pinote-scrollbar max-h-48 overflow-y-auto px-2.5 py-2"
                style={
                  {
                    "--editor-font-family":
                      resolveEditorFontFamily(editorFontFamily),
                    "--editor-font-size": `${editorFontSize}px`,
                    "--editor-line-height": editorLineHeight.toString(),
                  } as CSSProperties
                }
              >
                <MilkdownProvider>
                  <NotePreview
                    key={preview.notePath}
                    markdown={preview.content}
                  />
                </MilkdownProvider>
              </div>
            </div>
          </aside>,
          document.body,
        )}
      {historyError && (
        <div className="text-xs text-destructive">{historyError}</div>
      )}
    </div>
  );
}
