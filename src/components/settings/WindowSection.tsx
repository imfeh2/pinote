import { Move } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import type { Settings } from "@/stores/settings";

interface WindowSectionProps {
  settings: Settings;
  taskbarBusy: boolean;
  taskbarError: string | null;
  bringNotesBackBusy: boolean;
  bringNotesBackError: string | null;
  bringNotesBackResult: string | null;
  onTaskbarVisibility: () => Promise<void>;
  onRetryTaskbarVisibility?: () => Promise<void>;
  onBringNotesBack: () => Promise<void>;
}

export function WindowSection({
  settings,
  taskbarBusy,
  taskbarError,
  bringNotesBackBusy,
  bringNotesBackError,
  bringNotesBackResult,
  onTaskbarVisibility,
  onRetryTaskbarVisibility,
  onBringNotesBack,
}: WindowSectionProps) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("window.taskbar.label")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("window.taskbar.description")}
          </div>
        </div>
        <SettingsSwitch
          checked={settings.hideNoteWindowsFromTaskbar}
          label={t("window.taskbar.label")}
          disabled={taskbarBusy}
          onCheckedChange={() => {
            void onTaskbarVisibility();
          }}
        />
      </div>

      {taskbarError ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-xs text-destructive"
        >
          <span>{taskbarError}</span>
          {onRetryTaskbarVisibility ? (
            <Button
              disabled={taskbarBusy}
              onClick={() => void onRetryTaskbarVisibility()}
            >
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("window.lostNotes.label")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("window.lostNotes.description")}
          </div>
          {bringNotesBackResult && (
            <div className="text-[11px] text-muted-foreground">
              {bringNotesBackResult}
            </div>
          )}
          {bringNotesBackError && (
            <div className="text-[11px] text-destructive">
              {bringNotesBackError}
            </div>
          )}
        </div>
        <Button
          disabled={bringNotesBackBusy}
          onClick={() => void onBringNotesBack()}
          className="inline-flex shrink-0 items-center gap-1.5 bg-background px-2 text-muted-foreground transition-colors"
        >
          <Move className="h-3.5 w-3.5" />
          {bringNotesBackBusy
            ? t("window.lostNotes.moving")
            : t("window.lostNotes.action")}
        </Button>
      </div>
    </div>
  );
}
