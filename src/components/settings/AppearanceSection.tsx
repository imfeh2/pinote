import { useTranslation } from "react-i18next";
import { SettingsNumberInput } from "@/components/settings/SettingsNumberInput";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import {
  fontFamilyOptions,
  themeOptions,
  windowsGlassEffectOptions,
} from "@/components/settings/shared";
import type { LanguagePreference } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import type { RuntimePlatform } from "@/lib/windowApi";
import type { Settings } from "@/stores/settings";
import type { SettingsPatch } from "@/stores/settingsStore";

const languageOptions: Array<{ value: LanguagePreference; labelKey: string }> =
  [
    { value: "system", labelKey: "appearance.language.options.system" },
    { value: "en-US", labelKey: "appearance.language.options.enUS" },
    { value: "zh-CN", labelKey: "appearance.language.options.zhCN" },
  ];

interface AppearanceSectionProps {
  settings: Settings;
  runtimePlatform: RuntimePlatform;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
}

export function AppearanceSection({
  settings,
  runtimePlatform,
  updateSettings,
}: AppearanceSectionProps) {
  const { t } = useTranslation("settings");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("appearance.language.label")}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {languageOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateSettings({ language: option.value })}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                settings.language === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent",
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("appearance.theme.label")}
        </div>
        <div className="flex items-center gap-2">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateSettings({ theme: option.value })}
              className={cn(
                "flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                settings.theme === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent",
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {runtimePlatform !== "other" && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t("appearance.glass.label")}
          </div>
          {runtimePlatform === "windows" ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                {windowsGlassEffectOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      updateSettings({ noteGlassEffectWindows: option.value })
                    }
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-left text-xs font-medium transition-colors",
                      settings.noteGlassEffectWindows === option.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <span className="block">{t(option.labelKey)}</span>
                    <span
                      className={cn(
                        "block text-[10px] font-normal leading-tight",
                        settings.noteGlassEffectWindows === option.value
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground/80",
                      )}
                    >
                      {t(option.descriptionKey)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("appearance.glass.enable")}
              </div>
              <SettingsSwitch
                checked={settings.noteGlassEffectMacos}
                label={t("appearance.glass.enable")}
                onCheckedChange={(checked) =>
                  updateSettings({ noteGlassEffectMacos: checked })
                }
              />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("appearance.typography.label")}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">
            {t("appearance.typography.fontFamily")}
          </div>
          <div className="flex items-center gap-2">
            {fontFamilyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  updateSettings({ editorFontFamily: option.value })
                }
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                  settings.editorFontFamily === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t("appearance.typography.fontSize")}
            </div>
            <SettingsNumberInput
              value={settings.editorFontSize}
              min={12}
              max={24}
              step={1}
              suffix="px"
              label={t("appearance.typography.fontSize")}
              onValueChange={(editorFontSize) =>
                updateSettings({ editorFontSize })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t("appearance.typography.lineHeight")}
            </div>
            <SettingsNumberInput
              value={settings.editorLineHeight}
              min={1.2}
              max={2.2}
              step={0.1}
              precision={1}
              label={t("appearance.typography.lineHeight")}
              onValueChange={(editorLineHeight) =>
                updateSettings({ editorLineHeight })
              }
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("appearance.spacing.label")}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t("appearance.spacing.horizontal")}
            </div>
            <SettingsNumberInput
              value={settings.editorPaddingX}
              min={0}
              max={64}
              step={1}
              suffix="px"
              label={t("appearance.spacing.horizontal")}
              onValueChange={(editorPaddingX) =>
                updateSettings({ editorPaddingX })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t("appearance.spacing.vertical")}
            </div>
            <SettingsNumberInput
              value={settings.editorPaddingY}
              min={0}
              max={64}
              step={1}
              suffix="px"
              label={t("appearance.spacing.vertical")}
              onValueChange={(editorPaddingY) =>
                updateSettings({ editorPaddingY })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
