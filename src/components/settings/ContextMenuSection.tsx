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
import { GripVertical, Info } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSwitch } from "@/components/settings/SettingsSwitch";
import { Tooltip } from "@/components/Tooltip";
import type { NoteContextMenuAction } from "@/lib/contextMenuApi";
import { cn } from "@/lib/utils";
import type { ContextMenuItem, Settings } from "@/stores/settings";
import type { SettingsPatch } from "@/stores/settingsStore";

interface ContextMenuSectionProps {
  settings: Settings;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
}

function SortableRow({
  item,
  label,
  note,
  onVisibleChange,
}: {
  item: ContextMenuItem;
  label: string;
  note: string | null;
  onVisibleChange: (visible: boolean) => Promise<void>;
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
  } = useSortable({ id: item.action });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "relative flex items-center gap-2 rounded-md bg-background px-2 py-1.5",
        isDragging && "z-10 shadow-md",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("contextMenu.reorder", { item: label })}
        className="cursor-grab touch-none rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-xs",
          item.visible ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        {note && (
          <Tooltip content={note}>
            <button
              type="button"
              aria-label={note}
              className="rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </span>
      <SettingsSwitch
        checked={item.visible}
        label={label}
        onCheckedChange={onVisibleChange}
      />
    </li>
  );
}

export function ContextMenuSection({
  settings,
  updateSettings,
}: ContextMenuSectionProps) {
  const { t } = useTranslation("settings");
  const [pendingItems, setPendingItems] = useState<ContextMenuItem[] | null>(
    null,
  );
  const items = pendingItems ?? settings.contextMenuItems;
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const label = (action: NoteContextMenuAction) =>
    t(`contextMenu.items.${action}`);

  const save = (next: ContextMenuItem[]) => {
    setPendingItems(next);
    const settle = () =>
      setPendingItems((current) => (current === next ? null : current));
    return updateSettings({ contextMenuItems: next }).then(settle, settle);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.action === active.id);
    const to = items.findIndex((item) => item.action === over.id);
    void save(arrayMove(items, from, to));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-background/60 p-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable: t("contextMenu.dragInstructions"),
            },
            announcements: {
              onDragStart: ({ active }) =>
                t("contextMenu.announcements.start", {
                  item: label(active.id as NoteContextMenuAction),
                }),
              onDragOver: ({ active, over }) =>
                over
                  ? t("contextMenu.announcements.over", {
                      item: label(active.id as NoteContextMenuAction),
                      target: label(over.id as NoteContextMenuAction),
                    })
                  : undefined,
              onDragEnd: ({ active }) =>
                t("contextMenu.announcements.end", {
                  item: label(active.id as NoteContextMenuAction),
                }),
              onDragCancel: ({ active }) =>
                t("contextMenu.announcements.cancel", {
                  item: label(active.id as NoteContextMenuAction),
                }),
            },
          }}
        >
          <SortableContext
            items={items.map((item) => item.action)}
            strategy={verticalListSortingStrategy}
          >
            <ul aria-label={t("contextMenu.label")} className="flex flex-col">
              {items.map((item) => (
                <SortableRow
                  key={item.action}
                  item={item}
                  label={label(item.action)}
                  note={
                    item.action === "minimize-window" &&
                    settings.hideNoteWindowsFromTaskbar
                      ? t("contextMenu.minimizeHidden")
                      : null
                  }
                  onVisibleChange={(visible) =>
                    save(
                      items.map((current) =>
                        current.action === item.action
                          ? { ...current, visible }
                          : current,
                      ),
                    )
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 p-3">
        <div className="text-xs font-medium text-muted-foreground">
          {t("contextMenu.opacity")}
        </div>
        <SettingsSwitch
          checked={settings.contextMenuFollowNoteOpacity}
          label={t("contextMenu.opacity")}
          onCheckedChange={(checked) =>
            void updateSettings({ contextMenuFollowNoteOpacity: checked })
          }
        />
      </div>
    </div>
  );
}
