// US federal holidays (5 U.S.C. 6103) for business-day counting on SEC deadlines.
// Observance rule (Executive Order 11582 practice, as applied by OPM): a holiday on Saturday is observed on the
// preceding Friday, a holiday on Sunday on the following Monday.
import { DateTime } from 'luxon';

const iso = (d: DateTime) => d.toISODate() as string;

/** The nth weekday (1 = Monday ... 7 = Sunday) of a month; n = -1 means the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): DateTime {
  if (n > 0) {
    const first = DateTime.utc(year, month, 1);
    const offset = (weekday - first.weekday + 7) % 7;
    return first.plus({ days: offset + (n - 1) * 7 });
  }
  const last = DateTime.utc(year, month, 1).endOf('month').startOf('day');
  const offset = (last.weekday - weekday + 7) % 7;
  return last.minus({ days: offset });
}

function observed(d: DateTime): DateTime {
  if (d.weekday === 6) return d.minus({ days: 1 });
  if (d.weekday === 7) return d.plus({ days: 1 });
  return d;
}

/** Observed US federal holidays for a calendar year, as YYYY-MM-DD strings. */
export function usFederalHolidays(year: number): Set<string> {
  const fixed = [
    DateTime.utc(year, 1, 1), // New Year's Day
    DateTime.utc(year, 6, 19), // Juneteenth National Independence Day
    DateTime.utc(year, 7, 4), // Independence Day
    DateTime.utc(year, 11, 11), // Veterans Day
    DateTime.utc(year, 12, 25), // Christmas Day
  ].map(observed);
  const floating = [
    nthWeekday(year, 1, 1, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving Day
  ];
  const set = new Set([...fixed, ...floating].map(iso));
  // New Year's Day of the following year can be observed on Dec 31 of this year.
  const nextNewYear = observed(DateTime.utc(year + 1, 1, 1));
  if (nextNewYear.year === year) set.add(iso(nextNewYear));
  return set;
}

/** True when the local date (YYYY-MM-DD) is a weekday that is not a US federal holiday. */
export function isUsBusinessDay(localDate: DateTime): boolean {
  if (localDate.weekday >= 6) return false;
  return !usFederalHolidays(localDate.year).has(localDate.toISODate() as string);
}
