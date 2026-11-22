import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronsUpDown, GripVertical, Info, Plus, X } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/Combobox";
import { MarkdownPreview } from "@/components/Editor";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import { Tooltip } from "@/components/Tooltip";
import { listFontFamilies } from "@/lib/fonts";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { type EditorFont, resolveEditorFontFamily } from "@/stores/settings";

const fontStyle = (family: string) => ({
  fontFamily: resolveEditorFontFamily([{ family, enabled: true }]),
});

function FontRow({
  font: { family, enabled },
  options,
  checked,
  onChange,
  onEnabledChange,
  onRemove,
}: {
  font: EditorFont;
  options: string[];
  checked: string[];
  onChange: (family: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("settings");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: family });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative flex items-center gap-2 rounded-md py-1",
        isDragging && "z-10 bg-background shadow-md",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("appearance.typography.reorderFont", { font: family })}
        className="cursor-grab touch-none rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <Combobox
        options={options}
        value={family}
        checked={checked}
        label={t("appearance.typography.fontList")}
        searchPlaceholder={t("appearance.typography.searchFonts")}
        emptyText={t("appearance.typography.noFonts")}
        optionStyle={fontStyle}
        onSelect={onChange}
      >
        <button
          type="button"
          aria-label={t("appearance.typography.changeFont", { font: family })}
          className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-border px-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !enabled && "text-muted-foreground",
            )}
            style={fontStyle(family)}
          >
            {family}
          </span>
          <ChevronsUpDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </Combobox>
      <SettingsSwitch
        checked={enabled}
        label={t("appearance.typography.useFont", { font: family })}
        onCheckedChange={onEnabledChange}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("appearance.typography.removeFont", { font: family })}
        className="cursor-pointer rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

export function FontFamilySetting({
  families,
  fontSize,
  lineHeight,
  onChange,
}: {
  families: EditorFont[];
  fontSize: number;
  lineHeight: number;
  onChange: (families: EditorFont[]) => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const preview = t("appearance.typography.preview");
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingFamilies, setPendingFamilies] = useState<EditorFont[] | null>(
    null,
  );
  const current = pendingFamilies ?? families;
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    let active = true;
    listFontFamilies().then(
      (families) => {
        if (active) setInstalled(families);
      },
      (error) => {
        logError("settings", "list_font_families_failed", error);
        if (active) setLoadError(String(error));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const save = (next: EditorFont[]) => {
    setPendingFamilies(next);
    const settle = () =>
      setPendingFamilies((pending) => (pending === next ? null : pending));
    return onChange(next).then(settle, settle);
  };

  const options = installed ?? [];
  const chosen = current.map((font) => font.family);

  const update = (family: string, change: Partial<EditorFont>) =>
    void save(
      current.map((font) =>
        font.family === family ? { ...font, ...change } : font,
      ),
    );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const index = (id: unknown) =>
      current.findIndex((font) => font.family === id);
    void save(arrayMove(current, index(active.id), index(over.id)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className="note-editor pinote-scrollbar max-h-48 overflow-y-auto rounded-md border border-border bg-background/60 px-3 py-2"
        style={
          {
            "--editor-font-family": resolveEditorFontFamily(current),
            "--editor-font-size": `${fontSize}px`,
            "--editor-line-height": lineHeight.toString(),
            "--editor-padding-x": "0px",
            "--editor-padding-y": "0px",
          } as CSSProperties
        }
      >
        <MarkdownPreview key={preview} markdown={preview} editable />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {t("appearance.typography.fontFamily")}
        <Tooltip content={t("appearance.typography.fontPriority")}>
          <button
            type="button"
            aria-label={t("appearance.typography.fontPriority")}
            className="rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <div className="flex flex-col">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable: t("appearance.typography.dragInstructions"),
            },
            announcements: {
              onDragStart: ({ active }) =>
                t("contextMenu.announcements.start", { item: active.id }),
              onDragOver: ({ active, over }) =>
                over
                  ? t("contextMenu.announcements.over", {
                      item: active.id,
                      target: over.id,
                    })
                  : undefined,
              onDragEnd: ({ active }) =>
                t("contextMenu.announcements.end", { item: active.id }),
              onDragCancel: ({ active }) =>
                t("contextMenu.announcements.cancel", { item: active.id }),
            },
          }}
        >
          <SortableContext
            items={chosen}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label={t("appearance.typography.fontList")}
              className="flex flex-col"
            >
              {current.map((font) => (
                <FontRow
                  key={font.family}
                  font={font}
                  options={options}
                  checked={chosen}
                  onChange={(family) => update(font.family, { family })}
                  onEnabledChange={(enabled) =>
                    update(font.family, { enabled })
                  }
                  onRemove={() =>
                    void save(current.filter((item) => item !== font))
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="flex items-center gap-2 py-1">
          <Plus
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Combobox
            options={options}
            checked={chosen}
            label={t("appearance.typography.fontList")}
            searchPlaceholder={t("appearance.typography.searchFonts")}
            emptyText={t("appearance.typography.noFonts")}
            optionStyle={fontStyle}
            onSelect={(family) =>
              void save([...current, { family, enabled: true }])
            }
          >
            <button
              type="button"
              disabled={!installed}
              className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-border px-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="min-w-0 flex-1 truncate">
                {t("appearance.typography.addFont")}
              </span>
              <ChevronsUpDown
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </Combobox>
          <span className="w-15 shrink-0" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="w-4 shrink-0" aria-hidden="true" />
          <div
            className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-border px-2 text-xs text-muted-foreground"
            style={{ fontFamily: resolveEditorFontFamily([]) }}
          >
            <span className="truncate">
              {t("appearance.typography.systemFont")}
            </span>
          </div>
          <span className="w-15 shrink-0" aria-hidden="true" />
        </div>
      </div>
      {loadError && (
        <div className="text-xs text-destructive">
          {t("appearance.typography.fontsLoadFailed", { error: loadError })}
        </div>
      )}
    </div>
  );
}
