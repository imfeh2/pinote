import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import type { Settings } from "@/stores/settings";
import type { SettingsPatch } from "@/stores/settingsStore";

interface PreferencesSectionProps {
  settings: Settings;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
}

export function PreferencesSection({
  settings,
  updateSettings,
}: PreferencesSectionProps) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const changeConfirmation = async (checked: boolean) => {
    setBusy(true);
    setError(false);
    try {
      await updateSettings({ confirmNoteDeletion: checked });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("preferences.confirmNoteDeletion")}
        </div>
        <SettingsSwitch
          checked={settings.confirmNoteDeletion}
          label={t("preferences.confirmNoteDeletion")}
          disabled={busy}
          onCheckedChange={(checked) => {
            void changeConfirmation(checked);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("errors.saveSettings")}
        </p>
      ) : null}
    </div>
  );
}
