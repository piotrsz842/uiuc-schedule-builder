// Downloads one semester of UIUC course data plus past GPAs into
// public/data/<year>-<term>.json, which the app loads.
//
// Usage: npm run fetch-data -- 2026 fall
//
// The app can't call the Course Explorer API from the browser (it sends no
// CORS headers), so this runs ahead of time and the result is committed.

import { mkdir, writeFile } from "node:fs/promises";
import type { Course, CourseData, GenEd } from "../src/types.ts";
import { crossListedCodes } from "../src/crossListings.ts";
import { computeGpas, parseSubjectList, parseSubjectXml } from "./parseCourses.ts";

const EXPLORER_URL = "https://courses.illinois.edu/cisapp/explorer/schedule";
const GPA_CSV_URL =
  "https://raw.githubusercontent.com/wadefagen/datasets/main/gpa/uiuc-gpa-dataset.csv";
/** How many years of grades to average, so GPAs reflect recent teaching. */
const GPA_YEARS = 5;
/** Parallel requests to UIUC: fast, without hammering their server. */
const CONCURRENCY = 4;
const TERMS = ["spring", "summer", "fall", "winter"];

async function fetchText(url: string, attempts = 3): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/** Run `task` on every item with at most `limit` running at once, keeping the input order. */
async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const year = Number(process.argv[2] ?? 2026);
  const term = (process.argv[3] ?? "fall").toLowerCase();
  if (!Number.isInteger(year) || year < 2000 || !TERMS.includes(term)) {
    console.error(`Usage: npm run fetch-data -- <year> <${TERMS.join("|")}>`);
    process.exit(1);
  }
  const termUrl = `${EXPLORER_URL}/${year}/${term}`;

  console.log(`Fetching subject list for ${term} ${year}...`);
  const subjects = parseSubjectList(await fetchText(`${termUrl}.xml`));
  console.log(`${subjects.length} subjects. Downloading courses...`);

  let done = 0;
  const perSubject = await mapWithLimit(subjects, CONCURRENCY, async (subject) => {
    const parsed = parseSubjectXml(await fetchText(`${termUrl}/${subject.code}.xml?mode=cascade`));
    done++;
    if (done % 20 === 0 || done === subjects.length) console.log(`  ${done}/${subjects.length} subjects`);
    return parsed;
  });

  const courses: Course[] = perSubject.flatMap((subject) => subject.courses);
  const genEds = new Map<string, GenEd>();
  for (const subject of perSubject) {
    for (const genEd of subject.genEds) genEds.set(genEd.code, genEd);
  }

  console.log("Fetching GPA dataset...");
  const minGpaYear = year - GPA_YEARS;
  const gpas = computeGpas(await fetchText(GPA_CSV_URL), minGpaYear);
  let withGpa = 0;
  for (const course of courses) {
    // Grades for a cross-listed class are recorded under only one of its codes,
    // so fall back to a twin's GPA when this code has none.
    const codes = [`${course.subject} ${course.number}`, ...crossListedCodes(course.description)];
    const courseGpas = codes.map((code) => gpas.get(code)).find(Boolean);
    if (!courseGpas) continue;
    course.gpa = courseGpas.course;
    course.instructorGpas = courseGpas.instructors;
    withGpa++;
  }

  const data: CourseData = {
    term: `${term[0].toUpperCase()}${term.slice(1)} ${year}`,
    downloaded: new Date().toISOString().slice(0, 10),
    gpaYears: `since ${minGpaYear}`,
    subjects,
    genEds: [...genEds.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    courses,
  };

  await mkdir("public/data", { recursive: true });
  const outputPath = `public/data/${year}-${term}.json`;
  const json = JSON.stringify(data);
  await writeFile(outputPath, json);
  const sectionCount = courses.reduce((sum, course) => sum + course.sections.length, 0);
  console.log(
    `Wrote ${outputPath}: ${courses.length} courses, ${sectionCount} sections, ` +
      `${withGpa} with GPA, ${genEds.size} Gen Eds, ${(json.length / 1e6).toFixed(1)} MB`,
  );
}

main().catch((error) => {
  console.error("Download failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
