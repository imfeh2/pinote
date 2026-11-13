import type { Heading } from "mdast";
import { toString as headingText } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const RELEASE_LOCALES = ["en-US", "zh-CN"] as const;

export type ReleaseLocale = (typeof RELEASE_LOCALES)[number];

export type ReleaseNotes = Record<ReleaseLocale, string>;

const HEADINGS: Record<ReleaseLocale, string> = {
  "en-US": "English",
  "zh-CN": "简体中文",
};

export function formatReleaseBody(notes: ReleaseNotes) {
  return `${RELEASE_LOCALES.map(
    (locale) => `## ${HEADINGS[locale]}\n\n${notes[locale].trim()}`,
  ).join("\n\n")}\n`;
}

export function releaseNotesFor(body: string, locale: ReleaseLocale) {
  const headingNames = Object.values(HEADINGS);
  const sections = unified()
    .use(remarkParse)
    .parse(body)
    .children.filter(
      (node): node is Heading =>
        node.type === "heading" &&
        node.depth === 2 &&
        headingNames.includes(headingText(node)),
    );
  const index = sections.findIndex(
    (heading) => headingText(heading) === HEADINGS[locale],
  );
  if (index === -1) return "";
  return body
    .slice(
      sections[index].position?.end.offset,
      sections[index + 1]?.position?.start.offset,
    )
    .trim();
}
