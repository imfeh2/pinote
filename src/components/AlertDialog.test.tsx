// @vitest-environment happy-dom

import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { AlertDialog } from "@/components/AlertDialog";

test("focus returns to the element that was focused when the dialog opened", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const returnFocusRef = createRef<HTMLElement>();
  const render = (open: boolean) =>
    act(async () =>
      root.render(
        <>
          <textarea />
          <AlertDialog
            open={open}
            title="Problem"
            cancelLabel="Cancel"
            returnFocusRef={returnFocusRef}
            onClose={() => {}}
          />
        </>,
      ),
    );
  await render(false);
  const editor = container.querySelector("textarea");
  editor?.focus();
  await render(true);
  expect(document.activeElement).not.toBe(editor);
  await render(false);
  expect(document.activeElement).toBe(editor);
  await act(async () => root.unmount());
  container.remove();
});
