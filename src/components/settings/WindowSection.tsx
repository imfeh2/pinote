import { FolderOpen, FolderSearch, Move } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import { cn } from "@/lib/utils";
import type { Settings } from "@/stores/settings";
import type { SettingsPatch } from "@/stores/settingsStore";

interface WindowSectionProps {
  settings: Settings;
  defaultNotesDirectory: string;
  effectiveNotesDirectory: string;
  notesDirectoryBusy: boolean;
  notesDirectoryError: string | null;
  startupBusy: boolean;
  startupEnabled: boolean | null;
  contextMenuEnabled: boolean | null;
  defaultOpenEnabled: boolean | null;
  startupError: string | null;
  taskbarBusy: boolean;
  taskbarError: string | null;
  bringNotesBackBusy: boolean;
  bringNotesBackError: string | null;
  bringNotesBackResult: string | null;
  contextMenuBusy: boolean;
  contextMenuError: string | null;
  defaultOpenBusy: boolean;
  defaultOpenError: string | null;
  updateSettings: (patch: SettingsPatch) => void;
  setNotesDirectoryError: (value: string | null) => void;
  onChooseNotesDirectory: () => Promise<void>;
  onOpenNotesDirectory: () => Promise<void>;
  onLaunchAtStartup: () => Promise<void>;
  onTaskbarVisibility: () => Promise<void>;
  onRetryTaskbarVisibility?: () => Promise<void>;
  onBringNotesBack: () => Promise<void>;
  onContextMenuIntegration: () => Promise<void>;
  onDefaultOpenIntegration: () => Promise<void>;
}

export function WindowSection({
  settings,
  defaultNotesDirectory,
  effectiveNotesDirectory,
  notesDirectoryBusy,
  notesDirectoryError,
  startupBusy,
  startupEnabled,
  contextMenuEnabled,
  defaultOpenEnabled,
  startupError,
  taskbarBusy,
  taskbarError,
  bringNotesBackBusy,
  bringNotesBackError,
  bringNotesBackResult,
  contextMenuBusy,
  contextMenuError,
  defaultOpenBusy,
  defaultOpenError,
  updateSettings,
  setNotesDirectoryError,
  onChooseNotesDirectory,
  onOpenNotesDirectory,
  onLaunchAtStartup,
  onTaskbarVisibility,
  onRetryTaskbarVisibility,
  onBringNotesBack,
  onContextMenuIntegration,
  onDefaultOpenIntegration,
}: WindowSectionProps) {
  const { t } = useTranslation("settings");
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
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
        <button
          type="button"
          disabled={bringNotesBackBusy}
          onClick={() => {
            void onBringNotesBack();
          }}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
            "border-border bg-background text-muted-foreground hover:bg-accent",
            bringNotesBackBusy && "cursor-not-allowed opacity-60",
          )}
        >
          <Move className="h-3.5 w-3.5" />
          {bringNotesBackBusy
            ? t("window.lostNotes.moving")
            : t("window.lostNotes.action")}
        </button>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("window.notesDirectory.label")}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={directoryDraft ?? settings.newNoteDirectory}
            onFocus={() => setDirectoryDraft(settings.newNoteDirectory)}
            onBlur={() => setDirectoryDraft(null)}
            onChange={(event) => {
              setDirectoryDraft(event.target.value);
              updateSettings({ newNoteDirectory: event.target.value });
              setNotesDirectoryError(null);
            }}
            placeholder={
              defaultNotesDirectory || t("window.notesDirectory.loading")
            }
            disabled={notesDirectoryBusy}
            className={cn(
              "h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary",
              notesDirectoryBusy && "cursor-not-allowed opacity-60",
            )}
          />
          <button
            type="button"
            onClick={() => {
              void onChooseNotesDirectory();
            }}
            disabled={notesDirectoryBusy}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors",
              "border-border bg-background text-muted-foreground hover:bg-accent",
              notesDirectoryBusy && "cursor-not-allowed opacity-60",
            )}
            aria-label={t("window.notesDirectory.choose")}
            title={t("window.notesDirectory.choose")}
          >
            <FolderSearch className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={notesDirectoryBusy || !effectiveNotesDirectory}
            onClick={() => {
              void onOpenNotesDirectory();
            }}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors",
              "border-border bg-background text-muted-foreground hover:bg-accent",
              (notesDirectoryBusy || !effectiveNotesDirectory) &&
                "cursor-not-allowed opacity-60",
            )}
            aria-label={t("window.notesDirectory.open")}
            title={t("window.notesDirectory.open")}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>
        {notesDirectoryError && (
          <div className="text-xs text-destructive">{notesDirectoryError}</div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("window.launchAtStartup")}
        </div>
        <SettingsSwitch
          checked={startupEnabled === true}
          label={t("window.launchAtStartup")}
          disabled={startupBusy || startupEnabled === null}
          onCheckedChange={() => {
            void onLaunchAtStartup();
          }}
        />
      </div>

      {startupError && (
        <div className="text-xs text-destructive">{startupError}</div>
      )}

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
              onClick={() => {
                void onRetryTaskbarVisibility();
              }}
            >
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("window.contextMenuOpacity.label")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("window.contextMenuOpacity.description")}
          </div>
        </div>
        <SettingsSwitch
          checked={settings.contextMenuFollowNoteOpacity}
          label={t("window.contextMenuOpacity.label")}
          onCheckedChange={(checked) =>
            updateSettings({ contextMenuFollowNoteOpacity: checked })
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("window.explorerMenu.label")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("window.explorerMenu.description")}
          </div>
        </div>
        <SettingsSwitch
          checked={contextMenuEnabled === true}
          label={t("window.explorerMenu.label")}
          disabled={contextMenuBusy || contextMenuEnabled === null}
          onCheckedChange={() => {
            void onContextMenuIntegration();
          }}
        />
      </div>

      {contextMenuError && (
        <div className="text-xs text-destructive">{contextMenuError}</div>
      )}

      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("window.defaultOpener.label")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("window.defaultOpener.description")}
          </div>
        </div>
        <SettingsSwitch
          checked={defaultOpenEnabled === true}
          label={t("window.defaultOpener.label")}
          disabled={defaultOpenBusy || defaultOpenEnabled === null}
          onCheckedChange={() => {
            void onDefaultOpenIntegration();
          }}
        />
      </div>

      {defaultOpenError && (
        <div className="text-xs text-destructive">{defaultOpenError}</div>
      )}
    </div>
  );
}
