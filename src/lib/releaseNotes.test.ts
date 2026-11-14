import { expect, test } from "vitest";
import { changelog } from "@/lib/changelog";
import {
  formatReleaseBody,
  RELEASE_LOCALES,
  releaseNotesFor,
} from "@/lib/releaseNotes";
import packageJson from "../../package.json";

test("the changelog covers the current version with every language", () => {
  expect(changelog.map((entry) => entry.version)).toContain(
    packageJson.version,
  );
  expect(changelog.map((entry) => entry.version)).not.toContain("unreleased");
  expect(changelog[0].version).toBe(
    [...changelog.map((entry) => entry.version)].sort((a, b) =>
      b.localeCompare(a, "en", { numeric: true }),
    )[0],
  );
  for (const entry of changelog) {
    for (const locale of RELEASE_LOCALES) {
      expect(entry.notes[locale]).not.toBe("");
    }
  }
});

test("release bodies give back each language's notes", () => {
  const notes = {
    "en-US": "> [!WARNING]\n> Back up first.\n\n### Added\n\n- English change",
    "zh-CN": "> [!WARNING]\n> 请先备份。\n\n### 新增\n\n- 中文改动",
  };
  for (const entry of [...changelog, { version: "x", notes }]) {
    const body = formatReleaseBody(entry.notes);
    for (const locale of RELEASE_LOCALES) {
      expect(releaseNotesFor(body, locale)).toBe(entry.notes[locale]);
      expect(releaseNotesFor(body.replace(/\n/g, "\r\n"), locale)).toBe(
        entry.notes[locale].replace(/\n/g, "\r\n"),
      );
    }
  }
  expect(releaseNotesFor("Plain body", "zh-CN")).toBe("");
});
