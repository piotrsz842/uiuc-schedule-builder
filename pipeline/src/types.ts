// Shape of the course data file. The download script (scripts/fetchCourses.ts)
// writes it and the app reads it, so both sides share these types.

/** Average GPA over past offerings, and how many students it is based on. */
export interface GpaSummary {
  average: number;
  students: number;
  /** How many of those students got an A+ (worth the same 4.0 as an A, so the average hides it). */
  aPlus: number;
}

export interface Meeting {
  /** Short type code from UIUC, e.g. "LEC", "DIS", "LAB", "OLC". */
  type: string;
  typeName: string;
  /** Days as UIUC writes them: M T W R F (R is Thursday). Empty if no set days. */
  days: string;
  /** Minutes since midnight, or null when the time is "ARRANGED". */
  start: number | null;
  end: number | null;
  location: string;
  /** Names as "Last, F", e.g. "Challen, G". */
  instructors: string[];
}

export interface Section {
  crn: string;
  /** Section code shown on registration, e.g. "AL1", "AYB". */
  code: string;
  /** Some sections have their own title (special topics); otherwise empty. */
  title: string;
  /** "1" for the full semester, "A" or "B" for first or second half. */
  partOfTerm: string;
  /** Who may register, as UIUC writes it, e.g. "Restricted to Aerospace Engineering major(s)." */
  restrictions: string;
  /**
   * A sentence from the section's free-text notes saying who it's for (e.g. "This section is
   * for students at Wilbur Wright Community College..."), or "". Shown, not acted on.
   */
  audienceNote: string;
  meetings: Meeting[];
}

export interface Course {
  subject: string;
  number: string;
  title: string;
  /** Credit hours as UIUC writes them, e.g. "3", "3 OR 4", "1 TO 3". */
  credits: string;
  description: string;
  /** Gen Ed attribute codes, e.g. ["1QR1"]. Look names up in CourseData.genEds. */
  genEds: string[];
  gpa: GpaSummary | null;
  /** Past GPA per instructor for this course, keyed by "Last, F". */
  instructorGpas: Record<string, GpaSummary>;
  sections: Section[];
}

export interface GenEd {
  code: string;
  name: string;
  /** Broader category, e.g. "Humanities & the Arts". */
  category: string;
}

export interface CourseData {
  term: string;
  /** ISO date the data was downloaded. */
  downloaded: string;
  /** Which grade data the GPAs are based on, e.g. "since 2022". */
  gpaYears: string;
  subjects: { code: string; name: string }[];
  genEds: GenEd[];
  courses: Course[];
}
