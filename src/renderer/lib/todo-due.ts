/**
 * When a To do (or a parked message) comes due: one optional date, with an
 * optional time. A date alone is due from the start of that day, so it shows
 * as due the next time you open the app that day. A time also sets an alert
 * for that moment.
 */

export interface DueDate {
  /** Local midnight of the day (date only), or the exact time, in ms. */
  at: number;
  /** A time was given, so an alert goes off at `at`. */
  timed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole days from `now`'s day to `at`'s day (0 today, 1 tomorrow, -1 yesterday). */
function dayOffset(at: number, now: number): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
}

export function isDue(due: DueDate | undefined, now: number): boolean {
  return !!due && now >= due.at;
}

/** The quick picks. Each is a day; a time can be added after. */
export type DuePick = 'tomorrow' | 'next-week';

export function dueFromPick(pick: DuePick, now: number): DueDate {
  const today = new Date(startOfDay(now));
  if (pick === 'tomorrow') {
    today.setDate(today.getDate() + 1);
  } else {
    // Next Monday, a week away when today is Monday.
    const ahead = ((8 - today.getDay()) % 7) || 7;
    today.setDate(today.getDate() + ahead);
  }
  return { at: today.getTime(), timed: false };
}

/** `YYYY-MM-DD` for an `<input type="date">`. */
export function dateInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:MM` for an `<input type="time">`. */
export function timeInputValue(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The inputs' values back to a due date. No date means none; a bad one too. */
export function dueFromInputs(date: string, time: string): DueDate | undefined {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!day) return undefined;
  const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (clock) d.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? undefined : { at: d.getTime(), timed: !!clock };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayName(at: number, now: number): string {
  const offset = dayOffset(at, now);
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  if (offset === -1) return 'yesterday';
  const d = new Date(at);
  // Within the week ahead the weekday is enough; further out, the date.
  if (offset > 1 && offset < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The day, and the time when one was set: "tomorrow 9:00 AM", "Mon". */
export function formatDue(due: DueDate, now: number): string {
  const day = dayName(due.at, now);
  return due.timed ? `${day} ${clockTime(due.at)}` : day;
}

/**
 * The To do's date as a line of text: "Due tomorrow 9:00 AM" ahead of time,
 * "Due today" once the day has come, "Overdue since Mon" after it.
 */
export function dueText(due: DueDate, now: number): string {
  if (!isDue(due, now)) return `Due ${formatDue(due, now)}`;
  const offset = dayOffset(due.at, now);
  if (offset === 0) return due.timed ? `Due since ${clockTime(due.at)}` : 'Due today';
  return `Overdue since ${dayName(due.at, now)}`;
}
