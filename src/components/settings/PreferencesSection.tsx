import { FolderOpen, FolderSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import { cn } from "@/lib/utils";
import type { Settings } from "@/stores/settings";
import type { SettingsPatch } from "@/stores/settingsStore";

interface PreferencesSectionProps {
  settings: Settings;
  defaultNotesDirectory: string;
  effectiveNotesDirectory: string;
  notesDirectoryBusy: boolean;
  notesDirectoryError: string | null;
  startupBusy: boolean;
  startupEnabled: boolean | null;
  startupError: string | null;
  contextMenuEnabled: boolean | null;
  contextMenuBusy: boolean;
  contextMenuError: string | null;
  defaultOpenEnabled: boolean | null;
  defaultOpenBusy: boolean;
  defaultOpenError: string | null;
  saveSettings: (patch: SettingsPatch) => Promise<void>;
  updateSettings: (patch: SettingsPatch) => void;
  setNotesDirectoryError: (value: string | null) => void;
  onChooseNotesDirectory: () => Promise<void>;
  onOpenNotesDirectory: () => Promise<void>;
  onLaunchAtStartup: () => Promise<void>;
  onContextMenuIntegration: () => Promise<void>;
  onDefaultOpenIntegration: () => Promise<void>;
}

export function PreferencesSection({
  settings,
  defaultNotesDirectory,
  effectiveNotesDirectory,
  notesDirectoryBusy,
  notesDirectoryError,
  startupBusy,
  startupEnabled,
  startupError,
  contextMenuEnabled,
  contextMenuBusy,
  contextMenuError,
  defaultOpenEnabled,
  defaultOpenBusy,
  defaultOpenError,
  saveSettings,
  updateSettings,
  setNotesDirectoryError,
  onChooseNotesDirectory,
  onOpenNotesDirectory,
  onLaunchAtStartup,
  onContextMenuIntegration,
  onDefaultOpenIntegration,
}: PreferencesSectionProps) {
  const { t } = useTranslation("settings");
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const changeConfirmation = async (checked: boolean) => {
    setBusy(true);
    setError(false);
    try {
      await saveSettings({ confirmNoteDeletion: checked });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("window.launchAtStartup")}
        </div>
        <SettingsSwitch
          checked={startupEnabled === true}
          label={t("window.launchAtStartup")}
          disabled={startupBusy || startupEnabled === null}
          onCheckedChange={() => void onLaunchAtStartup()}
        />
      </div>
      {startupError && (
        <div className="text-xs text-destructive">{startupError}</div>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("window.notesDirectory.label")}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label={t("window.notesDirectory.label")}
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
          <Button
            onClick={() => void onChooseNotesDirectory()}
            disabled={notesDirectoryBusy}
            className="inline-flex size-8 items-center justify-center bg-background p-0 text-muted-foreground transition-colors"
            aria-label={t("window.notesDirectory.choose")}
            title={t("window.notesDirectory.choose")}
          >
            <FolderSearch className="h-4 w-4" />
          </Button>
          <Button
            disabled={notesDirectoryBusy || !effectiveNotesDirectory}
            onClick={() => void onOpenNotesDirectory()}
            className="inline-flex size-8 items-center justify-center bg-background p-0 text-muted-foreground transition-colors"
            aria-label={t("window.notesDirectory.open")}
            title={t("window.notesDirectory.open")}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        {notesDirectoryError && (
          <div className="text-xs text-destructive">{notesDirectoryError}</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("preferences.confirmNoteDeletion")}
        </div>
        <SettingsSwitch
          checked={settings.confirmNoteDeletion}
          label={t("preferences.confirmNoteDeletion")}
          disabled={busy}
          onCheckedChange={(checked) => void changeConfirmation(checked)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("errors.saveSettings")}
        </p>
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
          onCheckedChange={() => void onContextMenuIntegration()}
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
          onCheckedChange={() => void onDefaultOpenIntegration()}
        />
      </div>
      {defaultOpenError && (
        <div className="text-xs text-destructive">{defaultOpenError}</div>
      )}
    </div>
  );
}
