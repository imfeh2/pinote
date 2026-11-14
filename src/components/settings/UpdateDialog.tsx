import { Download, RefreshCw, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownPreview } from "@/components/Editor";
import { normalizeAppLocale } from "@/i18n/locale";
import { releaseNotesFor } from "@/lib/releaseNotes";
import type { UpdateSnapshot } from "@/lib/updater";
import { cn } from "@/lib/utils";

interface UpdateDialogProps {
  snapshot: UpdateSnapshot;
  busy: boolean;
  error: string | null;
  onDownload: () => Promise<void>;
  onInstall: () => Promise<void>;
  onLater: () => void;
}

export function UpdateDialog({
  snapshot,
  busy,
  error,
  onDownload,
  onInstall,
  onLater,
}: UpdateDialogProps) {
  const { t, i18n } = useTranslation("settings");
  const notes = releaseNotesFor(
    snapshot.notes ?? "",
    normalizeAppLocale(i18n.resolvedLanguage),
  );
  const latestVersion = snapshot.latestVersion ?? t("common.unknown");
  const currentVersion = snapshot.currentVersion || t("common.unknown");
  const isDownloading = snapshot.state === "downloading";
  const isReady = snapshot.state === "readyToRestart";
  const actionDisabled = busy || snapshot.state === "checking";
  const progress = isDownloading ? (snapshot.downloadProgress ?? 0) : null;
  const actionContent = (
    <>
      {isReady ? <RefreshCw size={14} /> : <Download size={14} />}
      <span className="tabular-nums">
        {isReady
          ? t("updateDialog.restart")
          : isDownloading
            ? snapshot.downloadProgress === null
              ? t("updateDialog.downloading")
              : t("updateDialog.downloadingProgress", {
                  progress: snapshot.downloadProgress,
                })
            : t("updateDialog.download")}
      </span>
    </>
  );

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/72 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-xl">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Download size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {t("updateDialog.title")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("updateDialog.versions", { latestVersion, currentVersion })}
            </div>
          </div>
          <button
            type="button"
            aria-label={t("updateDialog.later")}
            disabled={busy || isDownloading}
            onClick={onLater}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent",
              (busy || isDownloading) && "cursor-not-allowed opacity-60",
            )}
          >
            <X size={15} />
          </button>
        </div>

        {notes ? (
          <div
            className="note-editor pinote-scrollbar mb-3 max-h-40 text-foreground"
            style={
              {
                "--editor-font-size": "12px",
                "--editor-line-height": "1.5",
                "--editor-padding-x": "0px",
                "--editor-padding-y": "0px",
              } as CSSProperties
            }
          >
            <MarkdownPreview markdown={notes} />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mb-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy || isDownloading}
            onClick={onLater}
            className={cn(
              "rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent",
              (busy || isDownloading) && "cursor-not-allowed opacity-60",
            )}
          >
            {t("updateDialog.later")}
          </button>
          {progress === null ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                void (isReady ? onInstall() : onDownload());
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90",
                actionDisabled && "cursor-not-allowed opacity-60",
              )}
            >
              {actionContent}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="relative inline-flex items-center gap-1.5 rounded-md border border-transparent bg-primary/10 bg-origin-border px-3 py-1.5 text-xs font-medium text-primary"
              style={{
                backgroundImage: `linear-gradient(to right, var(--color-primary) ${progress}%, transparent ${progress}%)`,
              }}
            >
              {actionContent}
              <span
                aria-hidden="true"
                className="absolute -inset-px flex items-center gap-1.5 border border-transparent px-3 py-1.5 text-primary-foreground"
                style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}
              >
                {actionContent}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
