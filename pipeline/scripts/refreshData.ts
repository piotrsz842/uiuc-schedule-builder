// The daily refresh: finds which semesters UIUC has posted, downloads them, and updates
// a site's data folder (one file per term, plus terms.json for the term menu). Nothing
// is written unless every download passes its check, so a bad day leaves the site as is.
//
// Usage: node scripts/refreshData.ts <data folder>

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chooseTerms, isSemester, type ListedTerm, type TermList } from "../src/terms.ts";
import type { CourseData } from "../src/types.ts";
import { problemWithNewTerm, problemWithUpdate } from "./checkData.ts";
import { downloadTerm, EXPLORER_URL } from "./fetchCourses.ts";
import { parseSubjectList, parseTermList } from "./parseCourses.ts";

/** A Course Explorer page, or "" if it doesn't exist (a year or term not posted yet). */
async function fetchListing(url: string): Promise<string> {
  const response = await fetch(url);
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/** The semesters UIUC lists from last year to next year, and whether each has classes yet. */
async function listTerms(year: number): Promise<ListedTerm[]> {
  const listed: ListedTerm[] = [];
  for (const calendarYear of [year - 1, year, year + 1]) {
    for (const term of parseTermList(await fetchListing(`${EXPLORER_URL}/${calendarYear}.xml`))) {
      if (!isSemester(term.id)) continue;
      const [termYear, season] = term.id.split("-");
      // A term can be listed before it's posted: then its page is missing or has no subjects.
      const subjects = parseSubjectList(await fetchListing(`${EXPLORER_URL}/${termYear}/${season}.xml`));
      listed.push({ ...term, hasClasses: subjects.length > 0 });
    }
  }
  return listed;
}

async function main() {
  const dataDir = process.argv[2];
  if (!dataDir || !existsSync(dataDir)) {
    console.error("Usage: node scripts/refreshData.ts <data folder>");
    process.exit(1);
  }
  const today = new Date();
  const terms = chooseTerms(await listTerms(today.getUTCFullYear()));
  if (terms.length === 0) throw new Error("Course Explorer lists no semester with classes.");
  console.log(`Term menu: ${terms.map((term) => `${term.label}${term.published ? "" : " (not posted yet)"}`).join(", ")}`);

  const downloads = new Map<string, CourseData>();
  for (const term of terms.filter((candidate) => candidate.published)) {
    const [year, season] = term.id.split("-");
    const data = await downloadTerm(Number(year), season);
    const path = join(dataDir, `${term.id}.json`);
    const problem = existsSync(path)
      ? problemWithUpdate(JSON.parse(readFileSync(path, "utf8")) as CourseData, data)
      : problemWithNewTerm(data);
    if (problem) throw new Error(problem);
    downloads.set(term.id, data);
  }

  // Every download passed: write the terms, the menu, and drop terms that left the menu.
  for (const [id, data] of downloads) writeFileSync(join(dataDir, `${id}.json`), JSON.stringify(data));
  const termList: TermList = { updated: today.toISOString().slice(0, 10), terms };
  writeFileSync(join(dataDir, "terms.json"), `${JSON.stringify(termList, null, 2)}\n`);
  for (const name of readdirSync(dataDir)) {
    if (name.endsWith(".json") && name !== "terms.json" && !downloads.has(name.slice(0, -".json".length))) {
      rmSync(join(dataDir, name));
      console.log(`Removed ${name}: no longer in the term menu.`);
    }
  }
}

// Run only from the command line.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("Refresh failed, nothing changed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
