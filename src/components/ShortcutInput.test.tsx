// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ShortcutInput } from "./ShortcutInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

test("clicking starts recording and a key press saves the shortcut", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  await act(async () =>
    root.render(
      <ShortcutInput label="New note" value="Alt+E" onChange={change} />,
    ),
  );
  const button = container.querySelector("button");
  if (!button) throw new Error("Missing shortcut button");
  expect(button.textContent).toBe("Alt+E");
  await act(async () => button.click());
  expect(document.activeElement).toBe(button);
  expect(button.textContent).toBe("shortcuts.pressKeys");
  await act(async () => {
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "n",
        code: "KeyN",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(change).toHaveBeenCalledWith("Alt+N");
  expect(button.textContent).toBe("Alt+E");
  await act(async () => root.unmount());
  container.remove();
});
