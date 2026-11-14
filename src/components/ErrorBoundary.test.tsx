// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  destroy: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: mocks.destroy }),
}));

function Broken(): never {
  throw new Error("Render failed");
}

test("render errors show the message, are logged and can close the window", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    ),
  );
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("crash.title");
  expect(alert?.textContent).toContain("Render failed");
  expect(mocks.logError).toHaveBeenCalledWith(
    "frontend",
    "render_failed",
    expect.objectContaining({ message: "Render failed" }),
    expect.objectContaining({ componentStack: expect.any(String) }),
  );
  const close = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "common.close",
  );
  await act(async () => close?.click());
  expect(mocks.destroy).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  container.remove();
});
