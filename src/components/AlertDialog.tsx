import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/Button";

interface AlertDialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  cancelLabel?: string;
  actions?: {
    label: string;
    destructive?: boolean;
    disabled?: boolean;
    start?: boolean;
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
          {...(description ? {} : { "aria-describedby": undefined })}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-background p-4 text-foreground shadow-xl"
          onEscapeKeyDown={(event) => {
            if (busy || !cancelLabel) event.preventDefault();
          }}
          onOpenAutoFocus={() => {
            const active = document.activeElement;
            if (
              active instanceof HTMLElement &&
              active !== document.body &&
              !active.closest('[role="alertdialog"]')
            )
              returnFocusRef.current = active;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <AlertDialogPrimitive.Title className="shrink-0 break-words text-sm font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description className="shrink-0 break-words text-xs text-muted-foreground">
              {description}
            </AlertDialogPrimitive.Description>
          ) : null}
          {children}
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {cancelLabel ? (
              <AlertDialogPrimitive.Cancel asChild disabled={busy}>
                <Button>{cancelLabel}</Button>
              </AlertDialogPrimitive.Cancel>
            ) : null}
            {actions.map(
              ({ label, destructive, disabled, start, onAction }) => (
                <AlertDialogPrimitive.Action
                  key={label}
                  asChild
                  disabled={busy || disabled}
                  onClick={(event) => {
                    event.preventDefault();
                    onAction();
                  }}
                >
                  <Button
                    variant={destructive ? "destructive" : "default"}
                    className={start ? "mr-auto" : undefined}
                  >
                    {label}
                  </Button>
                </AlertDialogPrimitive.Action>
              ),
            )}
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
