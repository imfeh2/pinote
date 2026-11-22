import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { eventToShortcut } from "@/lib/shortcuts";

interface ShortcutInputProps {
  label: string;
  value: string;
  onChange: (next: string) => void | Promise<void>;
  labelMeta?: ReactNode;
}

export function ShortcutInput({
  label,
  value,
  onChange,
  labelMeta,
}: ShortcutInputProps) {
  const { t } = useTranslation("settings");
  const [isRecording, setIsRecording] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const next = eventToShortcut(event);
      if (!next) return;
      setIsRecording(false);
      void onChange(next);
    },
    [onChange],
  );

  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {labelMeta}
      </span>
      <button
        type="button"
        onClick={(event) => event.currentTarget.focus()}
        onFocus={() => setIsRecording(true)}
        onBlur={() => setIsRecording(false)}
        onKeyDown={handleKeyDown}
        className="shrink-0 cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs whitespace-nowrap text-foreground outline-none transition-colors focus:border-primary"
      >
        {isRecording ? t("shortcuts.pressKeys") : value}
      </button>
    </label>
  );
}
