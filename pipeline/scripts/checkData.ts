// Checks a fresh download before the daily refresh publishes it, so a failed or
// partial download from Course Explorer never replaces good data on the live site.
//
// Usage: node scripts/checkData.ts <published.json> <downloaded.json>
// Exits with an error (and publishes nothing) if the download looks wrong.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { CourseData } from "../src/types.ts";

/** A download with fewer courses than this share of the current data is treated as broken. */
const MIN_SHARE_OF_COURSES = 0.9;

/** Why the downloaded data shouldn't replace the published data, or null if it's fine. */
export function problemWithUpdate(published: CourseData, downloaded: CourseData): string | null {
  if (downloaded.term !== published.term) {
    return `Downloaded ${downloaded.term}, but the site shows ${published.term}.`;
  }
  const minimum = Math.ceil(published.courses.length * MIN_SHARE_OF_COURSES);
  if (downloaded.courses.length < minimum) {
    return `Downloaded only ${downloaded.courses.length} courses; the site has ${published.courses.length}.`;
  }
  return null;
}

/** A new term with fewer courses than this is treated as a partial download. */
const MIN_NEW_TERM_COURSES = 100;

/** Why a term the site hasn't shown before shouldn't be published yet, or null if it's fine. */
export function problemWithNewTerm(downloaded: CourseData): string | null {
  if (downloaded.courses.length < MIN_NEW_TERM_COURSES) {
    return `Downloaded only ${downloaded.courses.length} courses for ${downloaded.term}.`;
  }
  return null;
}

function main() {
  const [publishedPath, downloadedPath] = process.argv.slice(2);
  if (!publishedPath || !downloadedPath) {
    console.error("Usage: node scripts/checkData.ts <published.json> <downloaded.json>");
    process.exit(1);
  }
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as CourseData;
  const problem = problemWithUpdate(read(publishedPath), read(downloadedPath));
  if (problem) {
    console.error(`Not publishing: ${problem}`);
    process.exit(1);
  }
  console.log("The download looks complete.");
}

// Run only from the command line, not when the tests import this file.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
