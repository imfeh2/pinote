import { expect, test, vi } from "vitest";
import { feedbackUrl } from "@/lib/feedback";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "windows",
  version: () => "10.0.26100",
  arch: () => "x86_64",
}));

test("the feedback link opens a new issue with the version and system filled in", () => {
  const url = new URL(feedbackUrl("https://github.com/imfeh2/pinote", "0.7.0"));
  expect(url.origin + url.pathname).toBe(
    "https://github.com/imfeh2/pinote/issues/new",
  );
  expect(url.searchParams.get("body")).toBe(
    "\n\n---\nPinote: 0.7.0\nOS: windows 10.0.26100 (x86_64)",
  );
});
