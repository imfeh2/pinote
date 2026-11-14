import {
  RELEASE_LOCALES,
  type ReleaseLocale,
  type ReleaseNotes,
} from "@/lib/releaseNotes";

export interface ChangelogEntry {
  version: string;
  notes: ReleaseNotes;
}

const files = import.meta.glob<string>("../../changelog/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const notesByVersion = new Map<string, Partial<ReleaseNotes>>();
for (const [path, content] of Object.entries(files)) {
  const match = path.match(/\/changelog\/([^/]+)\/([^/]+)\.md$/);
  if (!match) throw new Error(`Unexpected changelog file: ${path}`);
  const [, version, locale] = match;
  if (version === "unreleased") continue;
  if (!RELEASE_LOCALES.includes(locale as ReleaseLocale)) {
    throw new Error(`Unknown changelog language: ${path}`);
  }
  notesByVersion.set(version, {
    ...notesByVersion.get(version),
    [locale]: content.trim(),
  });
}

export const changelog: ChangelogEntry[] = Array.from(
  notesByVersion,
  ([version, notes]) => {
    for (const locale of RELEASE_LOCALES) {
      if (!notes[locale]) {
        throw new Error(`Missing ${locale} notes for version ${version}`);
      }
    }
    return { version, notes: notes as ReleaseNotes };
  },
).sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }));
