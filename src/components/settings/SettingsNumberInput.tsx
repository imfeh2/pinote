import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface SettingsNumberInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  suffix?: string;
  precision?: number;
  onValueChange: (value: number) => Promise<void> | void;
}

export function SettingsNumberInput({
  value,
  min,
  max,
  step,
  label,
  suffix,
  precision = 0,
  onValueChange,
}: SettingsNumberInputProps) {
  const formatValue = (nextValue: number) => nextValue.toFixed(precision);
  const [draft, setDraft] = useState(() => formatValue(value));
  const draftRef = useRef(draft);
  const savedValue = useRef(value);
  const pending = useRef<symbol | null>(null);

  const updateDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
  };

  useEffect(() => {
    savedValue.current = value;
    if (pending.current === null) {
      draftRef.current = value.toFixed(precision);
      setDraft(draftRef.current);
    }
  }, [value, precision]);

  const commit = async (nextValue: number) => {
    const clamped = Math.min(max, Math.max(min, nextValue));
    const rounded = Number(clamped.toFixed(precision));
    const request = Symbol();
    pending.current = request;
    updateDraft(formatValue(rounded));
    try {
      await onValueChange(rounded);
    } catch {
      if (
        pending.current === request &&
        draftRef.current === formatValue(rounded)
      )
        updateDraft(formatValue(savedValue.current));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  };

  const increment = (direction: number) => {
    const parsed = Number(draftRef.current);
    const current =
      draftRef.current.trim() !== "" && Number.isFinite(parsed)
        ? parsed
        : value;
    void commit(current + direction * step);
  };

  const commitDraft = () => {
    const parsed = Number(draftRef.current);
    if (draftRef.current.trim() === "" || !Number.isFinite(parsed)) {
      updateDraft(formatValue(value));
      return;
    }
    void commit(parsed);
  };

  return (
    <div className="flex h-8 w-24 overflow-hidden rounded-md border border-border bg-background transition-colors focus-within:border-primary">
      <label className="relative flex min-w-0 flex-1 cursor-text items-center px-2">
        <span className="min-w-0 flex-1 basis-0" />
        <span className="inline-grid min-w-0 overflow-hidden">
          <span
            aria-hidden="true"
            className="invisible col-start-1 row-start-1 text-xs whitespace-pre tabular-nums"
          >
            {draft || " "}
          </span>
          <input
            size={1}
            type="text"
            inputMode="decimal"
            aria-label={label}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDraft();
                event.currentTarget.blur();
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                increment(1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                increment(-1);
              }
            }}
            className="col-start-1 row-start-1 w-full min-w-0 bg-transparent p-0 text-center text-xs tabular-nums text-foreground outline-none"
          />
        </span>
        <span
          className={cn("flex-1 basis-0", suffix ? "min-w-3.5" : "min-w-0")}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </label>
      <div className="flex w-6 shrink-0 flex-col border-l border-border">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label} +${step}`}
          onClick={() => increment(1)}
          className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label} -${step}`}
          onClick={() => increment(-1)}
          className="flex min-h-0 flex-1 items-center justify-center border-t border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
