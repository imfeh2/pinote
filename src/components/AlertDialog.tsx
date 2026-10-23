import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

interface AlertDialogProps {
  open: boolean;
  title: string;
  description: string;
  children?: ReactNode;
  cancelLabel: string;
  actions?: {
    label: string;
    destructive?: boolean;
    onAction: () => void;
  }[];
  busy?: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function AlertDialog({
  open,
  title,
  description,
  children,
  cancelLabel,
  actions = [],
  busy = false,
  returnFocusRef,
  onClose,
}: AlertDialogProps) {
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialogPrimitive.Content
          aria-busy={busy}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <AlertDialogPrimitive.Title className="text-sm font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-xs text-muted-foreground">
            {description}
          </AlertDialogPrimitive.Description>
          {children}
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogPrimitive.Cancel
              disabled={busy}
              className="h-8 cursor-pointer rounded-md border border-border px-3 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cancelLabel}
            </AlertDialogPrimitive.Cancel>
            {actions.map(({ label, destructive, onAction }) => (
              <AlertDialogPrimitive.Action
                key={label}
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  onAction();
                }}
                className={cn(
                  "h-8 cursor-pointer rounded-md border px-3 text-xs focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40",
                  destructive
                    ? "border-transparent bg-destructive text-white hover:opacity-90"
                    : "border-border hover:bg-accent",
                )}
              >
                {label}
              </AlertDialogPrimitive.Action>
            ))}
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
