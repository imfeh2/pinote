import { readFileSync } from "node:fs";
import {
  type ChangelogEntry,
  formatReleaseBody,
} from "../src/lib/releaseNotes.ts";

const version = process.argv[2];
const changelog: ChangelogEntry[] = JSON.parse(
  readFileSync(new URL("../src/changelog.json", import.meta.url), "utf8"),
);
const entry = changelog.find((candidate) => candidate.version === version);
if (!entry) throw new Error(`No changelog entry for version ${version}`);
process.stdout.write(formatReleaseBody(entry));
