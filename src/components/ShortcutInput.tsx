import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { logError } from "@/lib/logger";
import { eventToShortcut } from "@/lib/shortcuts";
import { pauseGlobalShortcuts, resumeGlobalShortcuts } from "@/lib/windowApi";

function pauseShortcuts() {
  pauseGlobalShortcuts().catch((error) =>
    logError("shortcuts", "pause_global_shortcuts_failed", error),
  );
}

function resumeShortcuts() {
  resumeGlobalShortcuts().then(
    (snapshot) => {
      for (const message of snapshot.errors) {
        logError("shortcuts", "resume_global_shortcuts_failed", message);
      }
    },
    (error) => logError("shortcuts", "resume_global_shortcuts_failed", error),
  );
}

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
  const labelId = useId();
  const buttonId = useId();
  const pausedRef = useRef(false);

  useEffect(
    () => () => {
      if (pausedRef.current) resumeShortcuts();
    },
    [],
  );

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
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span id={labelId}>{label}</span>
        {labelMeta}
      </span>
      <button
        id={buttonId}
        type="button"
        aria-labelledby={`${labelId} ${buttonId}`}
        onClick={(event) => event.currentTarget.focus()}
        onFocus={() => {
          setIsRecording(true);
          pausedRef.current = true;
          pauseShortcuts();
        }}
        onBlur={() => {
          setIsRecording(false);
          pausedRef.current = false;
          resumeShortcuts();
        }}
        onKeyDown={handleKeyDown}
        className="shrink-0 cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs whitespace-nowrap text-foreground outline-none transition-colors focus:border-primary"
      >
        {isRecording ? t("shortcuts.pressKeys") : value}
      </button>
    </div>
  );
}
