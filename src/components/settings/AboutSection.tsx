import { Download, Github } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import type { UpdateSnapshot } from "@/lib/updater";
import { cn } from "@/lib/utils";
import type { Settings } from "@/stores/settings";

interface AboutSectionProps {
  appVersion: string;
  updateBusy: boolean;
  isCheckingUpdate: boolean;
  isDownloadingUpdate: boolean;
  updateStatusText: string;
  updateSnapshot: UpdateSnapshot;
  canDownloadUpdate: boolean;
  canInstallUpdate: boolean;
  settings: Settings;
  updateError: string | null;
  aboutError: string | null;
  dataExportBusy: boolean;
  dataExportMessage: string | null;
  dataExportError: string | null;
  onExportData: () => Promise<void>;
  diagnosticBusy: boolean;
  diagnosticMessage: string | null;
  diagnosticError: string | null;
  repositoryUrl: string;
  formatDateTime: (value: string) => string;
  onManualUpdateCheck: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onOpenRepository: () => Promise<void>;
  onSaveDiagnosticReport: () => Promise<void>;
}

export function AboutSection({
  appVersion,
  updateBusy,
  isCheckingUpdate,
  isDownloadingUpdate,
  updateStatusText,
  updateSnapshot,
  canDownloadUpdate,
  canInstallUpdate,
  settings,
  updateError,
  aboutError,
  dataExportBusy,
  dataExportMessage,
  dataExportError,
  onExportData,
  diagnosticBusy,
  diagnosticMessage,
  diagnosticError,
  repositoryUrl,
  formatDateTime,
  onManualUpdateCheck,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenRepository,
  onSaveDiagnosticReport,
}: AboutSectionProps) {
  const { t } = useTranslation("settings");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <h2 className="text-xs font-medium text-muted-foreground">
          {t("about.application.label")}
        </h2>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t("about.application.name")}
          </div>
          <div className="text-xs font-medium text-foreground">Pinote</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t("about.application.currentVersion")}
          </div>
          <div className="text-xs font-medium text-foreground">
            {appVersion}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t("about.application.releaseChannel")}
          </div>
          <div className="text-xs font-medium text-foreground">
            {t("about.application.stable")}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            {t("about.updates.label")}
          </div>
          <button
            type="button"
            disabled={updateBusy || isCheckingUpdate || isDownloadingUpdate}
            onClick={() => {
              void onManualUpdateCheck();
            }}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              "border-border bg-background text-muted-foreground hover:bg-accent",
              (updateBusy || isCheckingUpdate || isDownloadingUpdate) &&
                "cursor-not-allowed opacity-60",
            )}
          >
            {isCheckingUpdate
              ? t("about.updates.checking")
              : t("about.updates.check")}
          </button>
        </div>

        <div className="text-xs text-muted-foreground">{updateStatusText}</div>

        {updateSnapshot.latestVersion && (
          <div className="text-xs text-muted-foreground">
            {t("about.updates.versions", {
              currentVersion:
                updateSnapshot.currentVersion || t("common.unknown"),
              latestVersion: updateSnapshot.latestVersion,
            })}
          </div>
        )}

        {isDownloadingUpdate && updateSnapshot.downloadProgress !== null && (
          <div className="text-xs text-muted-foreground">
            {t("about.updates.progress", {
              progress: updateSnapshot.downloadProgress,
            })}
          </div>
        )}

        {canDownloadUpdate && (
          <button
            type="button"
            disabled={updateBusy || isDownloadingUpdate || isCheckingUpdate}
            onClick={() => {
              void onDownloadUpdate();
            }}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              "border-primary bg-primary text-primary-foreground hover:opacity-90",
              (updateBusy || isDownloadingUpdate || isCheckingUpdate) &&
                "cursor-not-allowed opacity-60",
            )}
          >
            {isDownloadingUpdate
              ? t("about.updates.downloading")
              : t("about.updates.download")}
          </button>
        )}

        {canInstallUpdate && (
          <button
            type="button"
            disabled={updateBusy}
            onClick={() => {
              void onInstallUpdate();
            }}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              "border-primary bg-primary text-primary-foreground hover:opacity-90",
              updateBusy && "cursor-not-allowed opacity-60",
            )}
          >
            {updateBusy
              ? t("about.updates.installing")
              : t("about.updates.restart")}
          </button>
        )}

        {settings.lastUpdateCheckAt && (
          <div className="text-[11px] text-muted-foreground">
            {t("about.updates.lastChecked", {
              date: formatDateTime(settings.lastUpdateCheckAt),
            })}
          </div>
        )}

        {updateError && (
          <div className="text-xs text-destructive">{updateError}</div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-muted-foreground">
            {t("dataExport.label")}
          </h2>
          <Button
            disabled={dataExportBusy}
            onClick={() => void onExportData()}
            className="inline-flex items-center gap-2 bg-background"
          >
            <Download size={14} aria-hidden="true" />
            <span>
              {t(dataExportBusy ? "dataExport.exporting" : "dataExport.export")}
            </span>
          </Button>
        </div>
        {dataExportMessage && (
          <div role="status" className="text-xs text-muted-foreground">
            {dataExportMessage}
          </div>
        )}
        {dataExportError && (
          <div role="alert" className="text-xs text-destructive">
            {dataExportError}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-muted-foreground">
            {t("about.troubleshooting.label")}
          </h2>
          <Button
            disabled={diagnosticBusy}
            onClick={() => void onSaveDiagnosticReport()}
            className="inline-flex items-center gap-2 bg-background"
          >
            <Download size={14} aria-hidden="true" />
            <span>
              {diagnosticBusy
                ? t("about.troubleshooting.saving")
                : t("about.troubleshooting.save")}
            </span>
          </Button>
        </div>
        {diagnosticMessage && (
          <div className="text-xs text-muted-foreground">
            {diagnosticMessage}
          </div>
        )}
        {diagnosticError && (
          <div className="text-xs text-destructive">{diagnosticError}</div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-muted-foreground">
            {t("about.project")}
          </h2>
          <Button
            onClick={() => void onOpenRepository()}
            className="inline-flex items-center gap-2 bg-background"
          >
            <Github size={14} aria-hidden="true" />
            <span>Pinote</span>
          </Button>
        </div>
        <div className="break-all text-[11px] text-muted-foreground">
          {repositoryUrl}
        </div>
      </div>

      {aboutError && (
        <div className="text-xs text-destructive">{aboutError}</div>
      )}
    </div>
  );
}
