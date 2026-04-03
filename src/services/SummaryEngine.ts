// Aggregates totals, trends, and period summaries.

export type Period = 'week' | 'month';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toIsoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function getCurrentWeekRange(now: Date = new Date()): {
  fromIsoDate: string;
  toIsoDate: string;
  label: string;
} {
  // Week = Monday 00:00 to Sunday 23:59 (v1 PRD)
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const fromIsoDate = toIsoDateLocal(monday);
  const toIsoDate = toIsoDateLocal(sunday);
  const fromDay = monday.getDate();
  const toDay = sunday.getDate();
  const fromWeekday = WEEKDAY_SHORT[monday.getDay()];
  const toWeekday = WEEKDAY_SHORT[sunday.getDay()];
  const toMonth = MONTH_SHORT[sunday.getMonth()];

  // Matches PRD sample style: "Mon 24 – Sun 30 Mar"
  return {
    fromIsoDate,
    toIsoDate,
    label: `${fromWeekday} ${fromDay} – ${toWeekday} ${toDay} ${toMonth}`,
  };
}

export function getCurrentMonthRange(now: Date = new Date()): {
  fromIsoDate: string;
  toIsoDate: string;
  label: string;
} {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = now;

  const fromIsoDate = toIsoDateLocal(from);
  const toIsoDate = toIsoDateLocal(to);
  const monthName = MONTH_LONG[to.getMonth()];
  const year = to.getFullYear();

  return { fromIsoDate, toIsoDate, label: `${monthName} ${year}` };
}

