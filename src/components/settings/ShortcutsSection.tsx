import { useTranslation } from "react-i18next";
import { ShortcutInput } from "@/components/ShortcutInput";
import {
  dragModifiers,
  dragMouseButtonOptions,
  type GlobalShortcutKey,
  globalShortcutKeys,
  type ShortcutKey,
  shortcutItems,
  wheelModifiers,
} from "@/components/settings/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ToggleGroup";
import { cn } from "@/lib/utils";
import type {
  DragModifier,
  Settings,
  WheelResizeModifier,
} from "@/stores/settings";
import type { SettingsPatch } from "@/stores/settingsStore";

interface ShortcutsSectionProps {
  settings: Settings;
  shortcutError: string | null;
  globalShortcutRegistration: Record<GlobalShortcutKey, boolean | null>;
  updateShortcut: (key: ShortcutKey, value: string) => void;
  updateSettings: (patch: SettingsPatch) => void;
}

export function ShortcutsSection({
  settings,
  shortcutError,
  globalShortcutRegistration,
  updateShortcut,
  updateSettings,
}: ShortcutsSectionProps) {
  const { t } = useTranslation("settings");
  const modifierLabel = (modifier: string) =>
    t(`shortcuts.modifiers.${modifier}`);
  const wheelMethods = (modifier: WheelResizeModifier) =>
    modifier === "none"
      ? []
      : [t("shortcuts.wheelWith", { modifier: modifierLabel(modifier) })];
  const interactions = [
    {
      key: "resize",
      methods: wheelMethods(settings.wheelResizeModifier),
    },
    {
      key: "opacity",
      methods: wheelMethods(settings.wheelOpacityModifier),
    },
    {
      key: "move",
      methods: [
        t("shortcuts.currentInteractions.methods.edgeDrag"),
        ...dragMouseButtonOptions
          .filter((option) => settings.dragMouseButtons.includes(option.value))
          .map((option) =>
            t(`shortcuts.currentInteractions.methods.${option.value}Drag`),
          ),
        ...(settings.dragModifier === "none"
          ? []
          : [
              t("shortcuts.currentInteractions.methods.leftDrag", {
                modifier: modifierLabel(settings.dragModifier),
              }),
            ]),
      ],
    },
    {
      key: "alwaysOnTop",
      methods: [t("shortcuts.currentInteractions.methods.middleClick")],
    },
    {
      key: "menu",
      methods: [t("shortcuts.currentInteractions.methods.rightClick")],
    },
  ].filter((interaction) => interaction.methods.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.keyboard")}
        </div>
        {shortcutItems.map((item) => (
          <ShortcutInput
            key={item.key}
            label={t(item.labelKey)}
            value={settings.shortcuts[item.key]}
            onChange={(value) => updateShortcut(item.key, value)}
            labelMeta={
              globalShortcutKeys.includes(item.key as GlobalShortcutKey) ? (
                <span
                  title={
                    globalShortcutRegistration[
                      item.key as GlobalShortcutKey
                    ] === true
                      ? t("shortcuts.global.registered")
                      : globalShortcutRegistration[
                            item.key as GlobalShortcutKey
                          ] === false
                        ? t("shortcuts.global.notRegistered")
                        : t("shortcuts.global.checking")
                  }
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                    globalShortcutRegistration[
                      item.key as GlobalShortcutKey
                    ] === true
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : globalShortcutRegistration[
                            item.key as GlobalShortcutKey
                          ] === false
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border bg-background/60 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      globalShortcutRegistration[
                        item.key as GlobalShortcutKey
                      ] === true
                        ? "bg-emerald-500"
                        : globalShortcutRegistration[
                              item.key as GlobalShortcutKey
                            ] === false
                          ? "bg-destructive"
                          : "bg-muted-foreground/50",
                    )}
                  />
                  {t("shortcuts.global.badge")}
                </span>
              ) : null
            }
          />
        ))}
        {shortcutError && (
          <div className="text-xs text-destructive">{shortcutError}</div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.wheelResize.label")}
        </div>
        <ToggleGroup
          type="single"
          aria-label={t("shortcuts.wheelResize.label")}
          value={
            settings.wheelResizeModifier === "none"
              ? ""
              : settings.wheelResizeModifier
          }
          onValueChange={(value) =>
            updateSettings({
              wheelResizeModifier: (value || "none") as WheelResizeModifier,
            })
          }
        >
          {wheelModifiers.map((modifier) => (
            <ToggleGroupItem key={modifier} value={modifier}>
              {modifierLabel(modifier)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.wheelOpacity.label")}
        </div>
        <ToggleGroup
          type="single"
          aria-label={t("shortcuts.wheelOpacity.label")}
          value={
            settings.wheelOpacityModifier === "none"
              ? ""
              : settings.wheelOpacityModifier
          }
          onValueChange={(value) =>
            updateSettings({
              wheelOpacityModifier: (value || "none") as WheelResizeModifier,
            })
          }
        >
          {wheelModifiers.map((modifier) => (
            <ToggleGroupItem key={modifier} value={modifier}>
              {modifierLabel(modifier)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.dragButton.label")}
        </div>
        <ToggleGroup
          type="multiple"
          aria-label={t("shortcuts.dragButton.mouseButtons")}
          value={settings.dragMouseButtons}
          onValueChange={(value) =>
            updateSettings({
              dragMouseButtons: dragMouseButtonOptions
                .map((option) => option.value)
                .filter((button) => value.includes(button)),
            })
          }
        >
          {dragMouseButtonOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          aria-label={t("shortcuts.dragButton.modifiers")}
          value={settings.dragModifier === "none" ? "" : settings.dragModifier}
          onValueChange={(value) =>
            updateSettings({
              dragModifier: (value || "none") as DragModifier,
            })
          }
        >
          {dragModifiers.map((modifier) => (
            <ToggleGroupItem key={modifier} value={modifier}>
              {t("shortcuts.dragButton.withLeft", {
                modifier: modifierLabel(modifier),
              })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.currentInteractions.label")}
        </div>
        {interactions.map((interaction) => (
          <div key={interaction.key} className="text-xs text-muted-foreground">
            {t(`shortcuts.currentInteractions.${interaction.key}`, {
              methods: interaction.methods.join(
                t("shortcuts.currentInteractions.separator"),
              ),
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
