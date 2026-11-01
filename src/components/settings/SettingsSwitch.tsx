import { useRef } from "react";
import { cn } from "@/lib/utils";

interface SettingsSwitchProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => Promise<void> | void;
}

export function SettingsSwitch({
  checked,
  label,
  disabled = false,
  onCheckedChange,
}: SettingsSwitchProps) {
  const pending = useRef<{ value: boolean } | null>(null);
  const toggle = () => {
    const request = { value: !(pending.current?.value ?? checked) };
    pending.current = request;
    const finish = () => {
      if (pending.current === request) pending.current = null;
    };
    void Promise.resolve(onCheckedChange(request.value)).then(finish, finish);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        disabled && "opacity-60",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform duration-150",
          checked ? "translate-x-[17px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
