// Pure functions that turn UIUC's raw data into the app's CourseData shape.
// Kept separate from the network code in fetchCourses.ts so they can be tested
// on small samples without downloading anything.

import { XMLParser } from "fast-xml-parser";
import type { Course, GenEd, GpaSummary, Meeting, Section } from "../src/types.ts";

// Tags that can repeat. The parser would otherwise return a single object
// instead of an array when there happens to be only one.
const ALWAYS_ARRAYS = new Set([
  "subject",
  "cascadingCourse",
  "detailedSection",
  "meeting",
  "instructor",
  "category",
  "genEdAttribute",
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  // Keep every value as a string: "124" is a course number, not arithmetic.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (tagName) => ALWAYS_ARRAYS.has(tagName),
});

// The XML is loosely typed, so describe just the parts we read.
// An element with attributes parses to an object with its text under "#text";
// one without attributes parses to a plain string.
type XmlText = string | { "#text"?: string; [attribute: string]: string | undefined };

function textOf(node: XmlText | undefined): string {
  return (typeof node === "string" ? node : node?.["#text"] ?? "").trim();
}

function attributeOf(node: XmlText | undefined, name: string): string {
  return typeof node === "object" ? (node[name] ?? "").trim() : "";
}
interface XmlMeeting {
  start?: string;
  end?: string;
  daysOfTheWeek?: string;
  roomNumber?: string;
  buildingName?: string;
  type?: XmlText;
  instructors?: { instructor?: XmlText[] };
}
interface XmlSection {
  id: string;
  sectionNumber?: string;
  sectionTitle?: string;
  partOfTerm?: string;
  sectionNotes?: string;
  sectionCappArea?: string;
  /** Free-text notes, which sometimes say who the section is for. */
  sectionText?: string;
  meetings?: { meeting?: XmlMeeting[] };
}
interface XmlCourse {
  id: string;
  label?: string;
  description?: string;
  creditHours?: string;
  /** Restrictions shared by every section, listed once on the course. */
  sectionRegistrationNotes?: string;
  sectionCappArea?: string;
  genEdCategories?: {
    category?: { description?: string; genEdAttributes?: { genEdAttribute?: XmlText[] } }[];
  };
  detailedSections?: { detailedSection?: XmlSection[] };
}

/** "03:30PM" -> 930 (minutes since midnight). Returns null for "ARRANGED" or anything unexpected. */
export function parseTime(text: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text?.trim() ?? "");
  if (!match) return null;
  const hour12 = Number(match[1]) % 12;
  const isPm = match[3].toUpperCase() === "PM";
  return (hour12 + (isPm ? 12 : 0)) * 60 + Number(match[2]);
}

/** "Hall, Steven R" or " Challen, G" -> "Hall, S" / "Challen, G", so both data sources match. */
export function normalizeInstructor(name: string): string {
  const [last, first = ""] = name.split(",").map((part) => part.trim());
  const initial = first.charAt(0).toUpperCase();
  return initial ? `${last}, ${initial}` : last;
}

/** "3 hours." -> "3", "1 TO 3 hours." -> "1 TO 3". */
function parseCredits(text: string | undefined): string {
  return (text ?? "").replace(/\s*hours?\.?\s*$/i, "").trim();
}

function parseMeeting(raw: XmlMeeting): Meeting {
  const days = (raw.daysOfTheWeek ?? "").trim();
  const building = (raw.buildingName ?? "").trim();
  const room = (raw.roomNumber ?? "").trim();
  return {
    type: attributeOf(raw.type, "code"),
    typeName: textOf(raw.type),
    days: days === "n.a." ? "" : days,
    start: parseTime(raw.start),
    end: parseTime(raw.end),
    location: building === "n.a." ? "" : [room, building].filter(Boolean).join(" "),
    instructors: (raw.instructors?.instructor ?? [])
      .map((instructor) => normalizeInstructor(textOf(instructor)))
      .filter(Boolean),
  };
}

// Phrases in free-text notes that say who a section is for.
const AUDIENCE_PHRASE =
  /this section is (for|reserved|restricted|only|open only|limited)|reserved for|restricted to|open only to|only for|for students (in|at|enrolled)/i;
// "This section is for 1 credit only" is about credit, not students.
const CREDIT_PHRASE = /\bfor \d+ credits?\b/i;

/**
 * The sentence of a free-text note that says who the section is for, e.g. "This section
 * is for students at Wilbur Wright Community College...", or "" if there isn't one.
 * Shown to the user rather than acted on, since these notes are too varied to parse.
 */
export function audienceNote(text: string | undefined): string {
  const sentences = (text ?? "").replace(/\s+/g, " ").split(/(?<=[.!])\s+/);
  const sentence = sentences.find((candidate) => AUDIENCE_PHRASE.test(candidate) && !CREDIT_PHRASE.test(candidate));
  return sentence?.trim() ?? "";
}

function parseSection(raw: XmlSection, course: XmlCourse): Section {
  // A section's own notes win; otherwise the course-wide ones apply to it.
  const restrictions = [
    raw.sectionNotes ?? course.sectionRegistrationNotes,
    raw.sectionCappArea ?? course.sectionCappArea,
  ];
  return {
    crn: raw.id,
    code: raw.sectionNumber?.trim() ?? "",
    title: raw.sectionTitle?.trim() ?? "",
    partOfTerm: raw.partOfTerm?.trim() ?? "1",
    restrictions: restrictions.map((text) => text?.trim() ?? "").filter(Boolean).join(" "),
    audienceNote: audienceNote(raw.sectionText),
    meetings: (raw.meetings?.meeting ?? []).map(parseMeeting),
  };
}

/**
 * Parse one subject's "cascade" XML from the Course Explorer API.
 * Returns its courses (without GPAs yet) and every Gen Ed attribute they mention.
 */
export function parseSubjectXml(xml: string): { courses: Course[]; genEds: GenEd[] } {
  const rawCourses: XmlCourse[] =
    xmlParser.parse(xml).subject?.[0]?.cascadingCourses?.cascadingCourse ?? [];
  const genEds = new Map<string, GenEd>();

  const courses = rawCourses.map((raw): Course => {
    const [subject, number] = raw.id.split(" ");
    const courseGenEds: string[] = [];
    for (const category of raw.genEdCategories?.category ?? []) {
      // Unnamed categories hold internal attributes (e.g. "1ESL"), not real Gen Eds.
      const categoryName = category.description?.trim();
      if (!categoryName) continue;
      for (const attribute of category.genEdAttributes?.genEdAttribute ?? []) {
        const code = attributeOf(attribute, "code");
        if (!code) continue;
        courseGenEds.push(code);
        genEds.set(code, { code, name: textOf(attribute) || code, category: categoryName });
      }
    }
    return {
      subject,
      number,
      title: raw.label?.trim() ?? "",
      credits: parseCredits(raw.creditHours),
      description: raw.description?.trim() ?? "",
      genEds: courseGenEds,
      gpa: null,
      instructorGpas: {},
      sections: (raw.detailedSections?.detailedSection ?? []).map((section) => parseSection(section, raw)),
    };
  });

  return { courses, genEds: [...genEds.values()] };
}

/** Parse the term XML (e.g. .../2026/fall.xml) into its list of subjects. */
export function parseSubjectList(xml: string): { code: string; name: string }[] {
  const listed = xmlParser.parse(xml).term?.subjects?.subject ?? [];
  const subjects: XmlText[] = Array.isArray(listed) ? listed : [listed];
  return subjects.map((subject) => ({ code: attributeOf(subject, "id"), name: textOf(subject) }));
}

/** Minimal CSV parser: handles quoted fields containing commas and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Grade columns in the GPA dataset and the points each one is worth.
const GRADE_POINTS: Record<string, number> = {
  "A+": 4.0,
  A: 4.0,
  "A-": 3.67,
  "B+": 3.33,
  B: 3.0,
  "B-": 2.67,
  "C+": 2.33,
  C: 2.0,
  "C-": 1.67,
  "D+": 1.33,
  D: 1.0,
  "D-": 0.67,
  F: 0.0,
};

/** Grade counts from one row (one offering) of the GPA dataset. */
interface GradeCounts {
  points: number;
  students: number;
  aPlus: number;
}

class GpaTotal {
  points = 0;
  students = 0;
  aPlus = 0;
  add(counts: GradeCounts): void {
    this.points += counts.points;
    this.students += counts.students;
    this.aPlus += counts.aPlus;
  }
  summary(): GpaSummary {
    return {
      average: Math.round((this.points / this.students) * 100) / 100,
      students: this.students,
      aPlus: this.aPlus,
    };
  }
}

export interface CourseGpas {
  course: GpaSummary;
  instructors: Record<string, GpaSummary>;
}

/**
 * Average the GPA dataset (github.com/wadefagen/datasets) per course and per
 * instructor, using only terms from `minYear` on so the numbers reflect recent teaching.
 * Withdrawals (W) are not graded, so they are left out of the average.
 */
export function computeGpas(csv: string, minYear: number): Map<string, CourseGpas> {
  const [header, ...rows] = parseCsv(csv);
  const column = (name: string) => header.indexOf(name);
  const yearColumn = column("Year");
  const subjectColumn = column("Subject");
  const numberColumn = column("Number");
  const instructorColumn = column("Primary Instructor");
  const aPlusColumn = column("A+");
  const gradeColumns = Object.keys(GRADE_POINTS).map((grade) => [column(grade), GRADE_POINTS[grade]]);

  const courseTotals = new Map<string, { course: GpaTotal; instructors: Map<string, GpaTotal> }>();
  for (const row of rows) {
    if (Number(row[yearColumn]) < minYear) continue;
    const counts: GradeCounts = { points: 0, students: 0, aPlus: Number(row[aPlusColumn]) || 0 };
    for (const [index, value] of gradeColumns) {
      const count = Number(row[index]) || 0;
      counts.points += count * value;
      counts.students += count;
    }
    if (counts.students === 0) continue;

    const key = `${row[subjectColumn]} ${row[numberColumn]}`;
    let totals = courseTotals.get(key);
    if (!totals) {
      totals = { course: new GpaTotal(), instructors: new Map() };
      courseTotals.set(key, totals);
    }
    totals.course.add(counts);

    const instructor = normalizeInstructor(row[instructorColumn] ?? "");
    if (instructor) {
      let instructorTotal = totals.instructors.get(instructor);
      if (!instructorTotal) {
        instructorTotal = new GpaTotal();
        totals.instructors.set(instructor, instructorTotal);
      }
      instructorTotal.add(counts);
    }
  }

  const result = new Map<string, CourseGpas>();
  for (const [key, totals] of courseTotals) {
    const instructors: Record<string, GpaSummary> = {};
    for (const [name, total] of totals.instructors) instructors[name] = total.summary();
    result.set(key, { course: totals.course.summary(), instructors });
  }
  return result;
}

/** A calendar year's terms from Course Explorer, with ids like "2027-spring" (the data file names). */
export function parseTermList(xml: string): { id: string; label: string }[] {
  const listed = xmlParser.parse(xml).calendarYear?.terms?.term ?? [];
  const terms: XmlText[] = Array.isArray(listed) ? listed : [listed];
  return terms.flatMap((term) => {
    const match = /\/(\d{4})\/(\w+)\.xml$/.exec(attributeOf(term, "href"));
    return match ? [{ id: `${match[1]}-${match[2]}`, label: textOf(term) }] : [];
  });
}
