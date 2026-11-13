import { expect, test } from "vitest";
import changelog from "@/changelog.json";
import {
  type ChangelogEntry,
  formatReleaseBody,
  RELEASE_LOCALES,
  releaseNotesFor,
} from "@/lib/releaseNotes";
import packageJson from "../../package.json";

const entries: ChangelogEntry[] = changelog;

test("the changelog covers the current version with every language", () => {
  expect(entries.map((entry) => entry.version)).toContain(packageJson.version);
  expect(new Set(entries.map((entry) => entry.version)).size).toBe(
    entries.length,
  );
  for (const entry of entries) {
    for (const locale of RELEASE_LOCALES) {
      expect(entry.changes[locale].length).toBeGreaterThan(0);
      expect(entry.changes[locale]).toHaveLength(entry.changes["en-US"].length);
    }
  }
});

test("release bodies give back each language's changes", () => {
  for (const entry of entries) {
    const body = formatReleaseBody(entry);
    for (const locale of RELEASE_LOCALES) {
      expect(releaseNotesFor(body, locale)).toEqual(entry.changes[locale]);
      expect(releaseNotesFor(body.replace(/\n/g, "\r\n"), locale)).toEqual(
        entry.changes[locale],
      );
    }
  }
});
