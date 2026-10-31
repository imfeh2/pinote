import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: "default" | "destructive" | "ghost";
}) {
  return (
    <button
      {...props}
      type={type}
      className={cn(
        "h-8 shrink-0 cursor-pointer rounded-md border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40",
        variant === "destructive"
          ? "border-transparent bg-destructive text-white hover:opacity-90"
          : variant === "ghost"
            ? "border-transparent hover:bg-accent"
            : "border-border hover:bg-accent",
        className,
      )}
    />
  );
}
