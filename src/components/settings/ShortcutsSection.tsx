import { useTranslation } from "react-i18next";
import { ShortcutInput } from "@/components/ShortcutInput";
import {
  dragModifierOptions,
  dragMouseButtonOptions,
  type GlobalShortcutKey,
  globalShortcutKeys,
  type ShortcutKey,
  shortcutItems,
  wheelResizeModifierOptions,
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
  activeWheelResizeModifier: (typeof wheelResizeModifierOptions)[number];
  activeWheelOpacityModifier: (typeof wheelResizeModifierOptions)[number];
  updateShortcut: (key: ShortcutKey, value: string) => void;
  updateSettings: (patch: SettingsPatch) => void;
}

export function ShortcutsSection({
  settings,
  shortcutError,
  globalShortcutRegistration,
  activeWheelResizeModifier,
  activeWheelOpacityModifier,
  updateShortcut,
  updateSettings,
}: ShortcutsSectionProps) {
  const { t } = useTranslation("settings");
  const modifierLabel = (labelKey: string) => t(labelKey);
  const activeDragModifier = dragModifierOptions.find(
    (option) => option.value === settings.dragModifier,
  );
  const dragMethods = [
    ...dragMouseButtonOptions
      .filter((option) => settings.dragMouseButtons.includes(option.value))
      .map((option) => t(option.labelKey)),
    ...(activeDragModifier
      ? [
          t("shortcuts.dragButton.withLeft", {
            modifier: modifierLabel(activeDragModifier.labelKey),
          }),
        ]
      : []),
  ];

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
          value={settings.wheelResizeModifier}
          onValueChange={(value) => {
            if (value)
              updateSettings({
                wheelResizeModifier: value as WheelResizeModifier,
              });
          }}
        >
          {wheelResizeModifierOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {modifierLabel(option.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="text-xs text-muted-foreground">
          {t("shortcuts.wheelResize.description", {
            modifier: modifierLabel(activeWheelResizeModifier.labelKey),
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.wheelOpacity.label")}
        </div>
        <ToggleGroup
          type="single"
          aria-label={t("shortcuts.wheelOpacity.label")}
          value={settings.wheelOpacityModifier}
          onValueChange={(value) => {
            if (value)
              updateSettings({
                wheelOpacityModifier: value as WheelResizeModifier,
              });
          }}
        >
          {wheelResizeModifierOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {modifierLabel(option.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="text-xs text-muted-foreground">
          {t("shortcuts.wheelOpacity.description", {
            modifier: modifierLabel(activeWheelOpacityModifier.labelKey),
          })}
        </div>
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
          value={activeDragModifier?.value ?? ""}
          onValueChange={(value) =>
            updateSettings({
              dragModifier: (value || "none") as DragModifier,
            })
          }
        >
          {dragModifierOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {t("shortcuts.dragButton.withLeft", {
                modifier: modifierLabel(option.labelKey),
              })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="text-xs text-muted-foreground">
          {dragMethods.length > 0
            ? t("shortcuts.dragButton.description")
            : t("shortcuts.dragButton.edgeOnly")}
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("shortcuts.currentInteractions.label")}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("shortcuts.currentInteractions.resize", {
            modifier: modifierLabel(activeWheelResizeModifier.labelKey),
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("shortcuts.currentInteractions.opacity", {
            modifier: modifierLabel(activeWheelOpacityModifier.labelKey),
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("shortcuts.currentInteractions.alwaysOnTop")}
        </div>
        {dragMethods.map((method) => (
          <div key={method} className="text-xs text-muted-foreground">
            {t("shortcuts.currentInteractions.move", { method })}
          </div>
        ))}
        <div className="text-xs text-muted-foreground">
          {t("shortcuts.currentInteractions.rightClick")}
        </div>
      </div>
    </div>
  );
}
