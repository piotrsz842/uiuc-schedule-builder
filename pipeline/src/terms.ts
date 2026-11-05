// Which semesters the app offers. The daily refresh writes data/terms.json with
// chooseTerms(); the app reads it to fill the term menu and open a term.

/** A semester in the term menu. Its courses are in data/<id>.json once published. */
export interface TermInfo {
  /** e.g. "2027-spring", also the data file's name. */
  id: string;
  /** e.g. "Spring 2027". */
  label: string;
  /** False while UIUC lists the term but hasn't posted its classes yet. */
  published: boolean;
}

/** data/terms.json: the term menu, newest first. */
export interface TermList {
  /** ISO date the list was made. */
  updated: string;
  terms: TermInfo[];
}

/** A term in UIUC's listing, and whether it has any classes yet. */
export interface ListedTerm {
  id: string;
  label: string;
  hasClasses: boolean;
}

/** Only the two main semesters; summer and winter sessions are left out. */
const SEASONS: Record<string, number> = { spring: 1, fall: 8 };
/** How many terms with classes the menu keeps (the current one and the one before). */
const PUBLISHED_IN_MENU = 2;

/** Whether a term id is a fall or spring semester (not a summer or winter session). */
export function isSemester(id: string): boolean {
  return id.split("-")[1] in SEASONS;
}

/** Sorts terms by date: "2027-spring" before "2027-fall" before "2028-spring". */
function termOrder(id: string): number {
  const [year, season] = id.split("-");
  return Number(year) * 10 + (SEASONS[season] ?? 0);
}

/**
 * The term menu, newest first: the next term that's listed but has no classes yet (so
 * it appears as soon as UIUC announces it), then the two newest terms with classes (so
 * the one people are still taking stays while they plan the next).
 */
export function chooseTerms(listed: ListedTerm[]): TermInfo[] {
  const semesters = listed
    .filter((term) => isSemester(term.id))
    .sort((a, b) => termOrder(b.id) - termOrder(a.id));
  const published = semesters.filter((term) => term.hasClasses);
  if (published.length === 0) return [];
  const newest = termOrder(published[0].id);
  const upcoming = semesters.filter((term) => !term.hasClasses && termOrder(term.id) > newest).at(-1);
  const menu = [...(upcoming ? [upcoming] : []), ...published.slice(0, PUBLISHED_IN_MENU)];
  return menu.map(({ id, label, hasClasses }) => ({ id, label, published: hasClasses }));
}

/**
 * The term to open: the one in the link (?term=), else the last one picked if it has
 * classes, else the newest term with classes.
 */
export function pickTerm(terms: TermInfo[], linked: string | null, lastPicked: string | null): TermInfo | undefined {
  const find = (id: string | null) => terms.find((term) => term.id === id);
  const fromLastVisit = find(lastPicked);
  return find(linked) ?? (fromLastVisit?.published ? fromLastVisit : undefined) ?? terms.find((term) => term.published);
}

/** Where a term's plan is saved in the browser, so each term keeps its own. */
export function planStorageKey(termId: string): string {
  return `uiuc-schedule-builder.plan.${termId}`;
}
