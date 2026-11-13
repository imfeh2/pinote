export const RELEASE_LOCALES = ["en-US", "zh-CN"] as const;

export type ReleaseLocale = (typeof RELEASE_LOCALES)[number];

export interface ChangelogEntry {
  version: string;
  changes: Record<ReleaseLocale, string[]>;
}

const HEADINGS: Record<ReleaseLocale, string> = {
  "en-US": "English",
  "zh-CN": "简体中文",
};

export function formatReleaseBody(entry: ChangelogEntry) {
  return `${RELEASE_LOCALES.map(
    (locale) =>
      `## ${HEADINGS[locale]}\n\n${entry.changes[locale]
        .map((change) => `- ${change}`)
        .join("\n")}`,
  ).join("\n\n")}\n`;
}

export function releaseNotesFor(body: string, locale: ReleaseLocale) {
  const changes: string[] = [];
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      inSection = line.slice(3).trim() === HEADINGS[locale];
    } else if (inSection && line.startsWith("- ")) {
      changes.push(line.slice(2));
    }
  }
  return changes;
}
