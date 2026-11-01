// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { SettingsNumberInput } from "./SettingsNumberInput";

test("continuous stepping uses the current draft while older saves are pending", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const update = vi.fn(
    (_value: number) =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (value: number) =>
    root.render(
      <SettingsNumberInput
        value={value}
        min={10}
        max={24}
        step={1}
        label="Font size"
        onValueChange={update}
      />,
    );
  try {
    await act(async () => render(15));
    const increment = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Font size +1"]',
    );
    const input = container.querySelector("input");
    if (!increment || !input) throw new Error("Missing number input");
    await act(async () => {
      increment.click();
      increment.click();
    });
    expect(update.mock.calls.map(([value]) => value)).toEqual([16, 17]);
    expect(input.value).toBe("17");
    await act(async () => {
      pending[0].resolve();
      render(16);
    });
    expect(input.value).toBe("17");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(update.mock.calls.map(([value]) => value)).toEqual([16, 17, 18, 17]);
    await act(async () => {
      pending[1].resolve();
      render(17);
    });
    await act(async () => {
      pending[2].resolve();
      render(18);
    });
    expect(input.value).toBe("17");
    await act(async () => {
      pending[3].reject(new Error("disk full"));
    });
    expect(input.value).toBe("18");
    await act(async () => increment.click());
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Missing native input setter");
      setter.call(input, "21");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => pending[4].reject(new Error("disk full")));
    expect(input.value).toBe("21");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(update).toHaveBeenLastCalledWith(20);
    await act(async () => {
      pending[5].resolve();
      render(20);
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
