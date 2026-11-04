// Cross-listed courses: the same class offered under several course numbers, like
// STAT 107, CS 107, and IS 107. Each listing has its own CRNs (you register under one),
// but the sections meet at the same times, so Browse shows them as one entry.

import type { Course } from "./types.ts";

/**
 * Codes of the courses this one is cross-listed with, read from its description:
 * "... Same as HIST 112 and AFST 112." -> ["HIST 112", "AFST 112"].
 */
export function crossListedCodes(description: string): string[] {
  const sameAs = /Same as ([^.]*)\./.exec(description)?.[1] ?? "";
  return [...sameAs.matchAll(/\b([A-Z]{2,4}) (\d{3})\b/g)].map((match) => `${match[1]} ${match[2]}`);
}

function courseCode(course: Course): string {
  return `${course.subject} ${course.number}`;
}

/** The section codes and times of a course, to tell whether two listings are really the same class. */
function sectionsKey(course: Course): string {
  return course.sections
    .map((section) => {
      const meetings = section.meetings.map((meeting) => `${meeting.type} ${meeting.days} ${meeting.start}-${meeting.end}`);
      return `${section.code}|${section.partOfTerm}|${meetings.join(";")}`;
    })
    .sort()
    .join(",");
}

/**
 * For each cross-listed course, every listing of the same class (itself included), sorted.
 * Listings only group when their sections are identical; ones that differ (e.g. a grad
 * version with other sections) stay separate. Courses that aren't cross-listed are left out.
 */
export function crossListGroups(courses: Course[]): Map<string, string[]> {
  const byCode = new Map(courses.map((course) => [courseCode(course), course]));
  // Union-find: each linked code points toward a representative code for its group.
  const parent = new Map<string, string>();
  const find = (code: string): string => {
    const up = parent.get(code) ?? code;
    if (up === code) return code;
    const root = find(up);
    parent.set(code, root);
    return root;
  };
  const link = (a: string, b: string) => {
    for (const code of [a, b]) if (!parent.has(code)) parent.set(code, code);
    parent.set(find(a), find(b));
  };

  for (const course of courses) {
    for (const twinCode of crossListedCodes(course.description)) {
      const twin = byCode.get(twinCode);
      if (twin && twin !== course && sectionsKey(twin) === sectionsKey(course)) link(courseCode(course), twinCode);
    }
  }

  const byRoot = new Map<string, string[]>();
  for (const code of parent.keys()) {
    const root = find(code);
    byRoot.set(root, [...(byRoot.get(root) ?? []), code]);
  }
  const groups = new Map<string, string[]>();
  for (const group of byRoot.values()) {
    const sorted = group.sort();
    for (const code of sorted) groups.set(code, sorted);
  }
  return groups;
}

/**
 * Keep only the first listing of each cross-listed class, in the given order. Since the
 * list is already filtered, a class shows up if any of its listings matched, labeled by
 * the first one that did (e.g. CS 107 when filtering by CS).
 */
export function collapseCrossListed(courses: Course[], groups: Map<string, string[]>): Course[] {
  const shown = new Set<string>();
  return courses.filter((course) => {
    const group = groups.get(courseCode(course));
    if (!group) return true;
    const key = group[0];
    if (shown.has(key)) return false;
    shown.add(key);
    return true;
  });
}

/** "Also listed as IS 107, STAT 107" for a cross-listed class, or "". */
export function alsoListedAs(code: string, crossLists: Map<string, string[]>): string {
  const others = (crossLists.get(code) ?? []).filter((other) => other !== code);
  return others.length > 0 ? `Also listed as ${others.join(", ")}` : "";
}

/** Whether this class is planned under any of its listings. */
export function isPlannedClass(code: string, plannedCodes: Set<string>, crossLists: Map<string, string[]>): boolean {
  return (crossLists.get(code) ?? [code]).some((listing) => plannedCodes.has(listing));
}
