import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Checkbox({
  checked,
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      checked={checked}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md text-primary outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      <span className="flex size-3.5 items-center justify-center rounded-sm border border-current">
        <CheckboxPrimitive.Indicator>
          {checked === "indeterminate" ? (
            <Minus size={12} />
          ) : (
            <Check size={12} />
          )}
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
