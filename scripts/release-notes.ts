import { readFileSync } from "node:fs";
import {
  formatReleaseBody,
  RELEASE_LOCALES,
  type ReleaseNotes,
} from "../src/lib/releaseNotes.ts";

const version = process.argv[2];
if (!version) throw new Error("Pass the version to print release notes for");
const notes = Object.fromEntries(
  RELEASE_LOCALES.map((locale) => [
    locale,
    readFileSync(
      new URL(`../changelog/${version}/${locale}.md`, import.meta.url),
      "utf8",
    ),
  ]),
) as ReleaseNotes;
process.stdout.write(formatReleaseBody(notes));
