import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/AlertDialog";
import { exportAppData } from "@/lib/dataExport";
import { convertLegacyNotes, finishLegacyNotes } from "@/lib/legacyNotes";
import { logError } from "@/lib/logger";

export function LegacyNotesDialog({
  open,
  count,
  onDone,
}: {
  open: boolean;
  count: number;
  onDone: () => void;
}) {
  const { t } = useTranslation("settings");
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState<"export" | "convert" | "finish" | null>(
    null,
  );
  const [failedCount, setFailedCount] = useState<number | null>(null);
  const [converted, setConverted] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy("export");
    setError(null);
    try {
      const result = await exportAppData();
      if (result) setBackupPath(result.destinationPath);
    } catch (exportError) {
      setError(t("dataExport.failed"));
      logError("settings", "legacy_notes_export_failed", exportError);
    } finally {
      setBusy(null);
    }
  };

  const handleConvert = async () => {
    setBusy("convert");
    setError(null);
    try {
      const failed = await convertLegacyNotes();
      if (failed === 0) {
        setConverted(true);
        setFailedCount(null);
      } else {
        setFailedCount(failed);
      }
      setBusy(null);
    } catch (convertError) {
      setError(t("legacyNotes.failed"));
      logError("settings", "legacy_notes_convert_failed", convertError);
      setBusy(null);
    }
  };

  const handleFinish = async () => {
    setBusy("finish");
    setError(null);
    try {
      await finishLegacyNotes();
      onDone();
    } catch (finishError) {
      setError(t("legacyNotes.finishFailed"));
      logError("settings", "legacy_notes_finish_failed", finishError);
      setBusy(null);
    }
  };

  const convertLabel = t(
    busy === "convert"
      ? "legacyNotes.converting"
      : failedCount === null
        ? "legacyNotes.convert"
        : "legacyNotes.retry",
  );

  return (
    <AlertDialog
      open={open}
      title={t("legacyNotes.title")}
      description={t("legacyNotes.description", { count })}
      busy={busy !== null}
      returnFocusRef={returnFocusRef}
      onClose={() => {}}
      actions={
        converted
          ? [{ label: t("legacyNotes.done"), onAction: onDone }]
          : failedCount === null
            ? [
                {
                  label: t("legacyNotes.skip"),
                  start: true,
                  onAction: () => void handleFinish(),
                },
                {
                  label: t(
                    busy === "export"
                      ? "legacyNotes.exporting"
                      : "legacyNotes.export",
                  ),
                  onAction: () => void handleExport(),
                },
                {
                  label: convertLabel,
                  disabled: backupPath === null,
                  onAction: () => void handleConvert(),
                },
              ]
            : [
                {
                  label: t("legacyNotes.done"),
                  onAction: () => void handleFinish(),
                },
                {
                  label: convertLabel,
                  onAction: () => void handleConvert(),
                },
              ]
      }
    >
      <p className="break-words text-xs text-muted-foreground">
        {t("legacyNotes.details")}
      </p>
      {backupPath !== null ? (
        <p
          role="status"
          className="flex items-start gap-1.5 break-all text-xs text-muted-foreground"
        >
          <Check
            size={14}
            aria-hidden="true"
            className="mt-px shrink-0 text-primary"
          />
          {t("legacyNotes.saved", { path: backupPath })}
        </p>
      ) : null}
      {converted ? (
        <p
          role="status"
          className="flex items-start gap-1.5 text-xs text-foreground"
        >
          <Check
            size={14}
            aria-hidden="true"
            className="mt-px shrink-0 text-primary"
          />
          {t("legacyNotes.converted")}
        </p>
      ) : null}
      {failedCount !== null || error ? (
        <p role="alert" className="text-xs text-destructive">
          {error ?? t("legacyNotes.partial", { count: failedCount })}
        </p>
      ) : null}
    </AlertDialog>
  );
}
