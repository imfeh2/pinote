import { describe, expect, it } from "vitest";
import { resolveEditorFontFamily } from "@/stores/settings";

describe("resolveEditorFontFamily", () => {
  it("quotes enabled fonts and ends with the system font", () => {
    expect(resolveEditorFontFamily([])).toBe(
      "system-ui, -apple-system, sans-serif",
    );
    expect(
      resolveEditorFontFamily([
        { family: "LXGW WenKai", enabled: true },
        { family: "Georgia", enabled: false },
        { family: 'Odd "Font\\', enabled: true },
      ]),
    ).toBe(
      '"LXGW WenKai", "Odd \\"Font\\\\", system-ui, -apple-system, sans-serif',
    );
  });
});
