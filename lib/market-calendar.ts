/**
 * Lean US equity market calendar (NYSE/Nasdaq trading sessions), computed from the actual
 * holiday RULES rather than a hand-maintained yearly date list — nothing here needs updating
 * year over year. No external calendar service, no manual DST math (date-fns-tz handles the
 * America/New_York <-> UTC conversion correctly, satisfying the PRD's "never manually add/
 * subtract an hour" requirement).
 *
 * TypeScript mirror of scripts/market-calendar.mjs (same logic, verified there against every
 * 2026 holiday/early-close and both DST transitions) — this copy is what the admin page uses so
 * a *manually* created battle locks/settles against the same real market session the automated
 * keeper would use, instead of an arbitrary relative offset.
 *
 * Covers: weekends, the 9 NYSE full-closure holidays (Sunday->Monday observance shift; Saturday
 * holidays are NOT observed, matching real NYSE practice), and the two consistently-observed
 * early closes (day after Thanksgiving, Christmas Eve). Rarer one-off early closes are not
 * covered — a disclosed gap, not a silent one.
 */
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

const TZ = "America/New_York";
const REGULAR_OPEN = "09:30:00";
const REGULAR_CLOSE = "16:00:00";
const EARLY_CLOSE = "13:00:00";

export interface TradingSession {
  marketStartAt: Date;
  marketEndAt: Date;
  earlyClose: boolean;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  // month: 1-12, weekday: 0=Sun..6=Sat, n: 1..5 (nth occurrence) or -1 (last occurrence)
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return 1 + offset + (n - 1) * 7;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, daysInMonth));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return daysInMonth - offset;
}

/** Sunday -> observed the following Monday. Saturday -> not observed (already a non-trading day). */
function observedDay(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? day + 1 : day;
}

/** Anonymous Gregorian (Meeus/Jones/Butcher) algorithm for Easter Sunday. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fullClosureHolidays(year: number): string[] {
  const easter = easterSunday(year);
  const easterUtc = new Date(Date.UTC(year, easter.month - 1, easter.day));
  const goodFriday = new Date(easterUtc.getTime() - 2 * 86400000);
  return [
    `${year}-01-${pad(observedDay(year, 1, 1))}`, // New Year's Day
    `${year}-01-${pad(nthWeekdayOfMonth(year, 1, 1, 3))}`, // MLK Day
    `${year}-02-${pad(nthWeekdayOfMonth(year, 2, 1, 3))}`, // Presidents Day
    `${year}-${pad(goodFriday.getUTCMonth() + 1)}-${pad(goodFriday.getUTCDate())}`, // Good Friday
    `${year}-05-${pad(nthWeekdayOfMonth(year, 5, 1, -1))}`, // Memorial Day
    `${year}-06-${pad(observedDay(year, 6, 19))}`, // Juneteenth
    `${year}-07-${pad(observedDay(year, 7, 4))}`, // Independence Day
    `${year}-09-${pad(nthWeekdayOfMonth(year, 9, 1, 1))}`, // Labor Day
    `${year}-11-${pad(nthWeekdayOfMonth(year, 11, 4, 4))}`, // Thanksgiving
    `${year}-12-${pad(observedDay(year, 12, 25))}`, // Christmas
  ];
}

function earlyCloseDays(year: number): string[] {
  const thanksgivingDay = nthWeekdayOfMonth(year, 11, 4, 4);
  return [
    `${year}-11-${pad(thanksgivingDay + 1)}`, // day after Thanksgiving
    `${year}-12-24`, // Christmas Eve (only matters if it's otherwise a trading day)
  ];
}

/** "YYYY-MM-DD" for `instant` as observed in America/New_York. */
export function nyDateString(instant: Date | number = new Date()): string {
  return formatInTimeZone(instant, TZ, "yyyy-MM-dd");
}

/**
 * Trading session for a given NY-local date ("YYYY-MM-DD"), or `null` if it's a weekend or a
 * full-closure holiday. `marketStartAt`/`marketEndAt` are real UTC instants.
 */
export function tradingSessionFor(nyDate: string): TradingSession | null {
  const [year, month, day] = nyDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return null; // weekend

  if (fullClosureHolidays(year).includes(nyDate)) return null;

  const isEarlyClose = earlyCloseDays(year).includes(nyDate);
  return {
    marketStartAt: fromZonedTime(`${nyDate}T${REGULAR_OPEN}`, TZ),
    marketEndAt: fromZonedTime(`${nyDate}T${isEarlyClose ? EARLY_CLOSE : REGULAR_CLOSE}`, TZ),
    earlyClose: isEarlyClose,
  };
}

/**
 * The next trading session whose market open is still in the future relative to `from` — what
 * the admin page uses when manually creating a battle "right now". Walks forward a day at a
 * time (bounded to 14 days — real NYSE closures never run longer, this is just a safety bound
 * against an infinite loop from a calendar bug) skipping weekends/holidays, and additionally
 * skips today's session if it's already open (mirrors scripts/keeper.mjs's same "too late to
 * open entries today" rule, so a manually-created battle always has a real, testable entry
 * window instead of one that's already closed).
 */
export function nextTradingSession(from: Date = new Date()): { nyDate: string; session: TradingSession } {
  for (let offset = 0; offset < 14; offset++) {
    const candidate = new Date(from.getTime() + offset * 86400000);
    const nyDate = nyDateString(candidate);
    const session = tradingSessionFor(nyDate);
    if (session && session.marketStartAt.getTime() > from.getTime()) {
      return { nyDate, session };
    }
  }
  throw new Error("no trading session found in the next 14 days — market calendar likely broken");
}
