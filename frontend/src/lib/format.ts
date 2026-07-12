// Date/number display helpers. All timestamps travel as ISO strings and render
// in the viewer's local timezone, in mono per the type system.

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateShortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateShortFmt.format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return timeFmt.format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

export function fmtWeekday(iso: string): string {
  return weekdayFmt.format(new Date(iso));
}

/** "09:00–10:30" (times only — for same-day ranges like booking slots). */
export function fmtTimeRange(startIso: string, endIso: string): string {
  return `${fmtTime(startIso)}–${fmtTime(endIso)}`;
}

/** "12 Jun, 09:00–10:30" or spans days: "12 Jun 14:00 – 13 Jun 10:00". */
export function fmtSlot(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (s.toDateString() === e.toDateString()) {
    return `${dateShortFmt.format(s)}, ${fmtTimeRange(startIso, endIso)}`;
  }
  return `${dateShortFmt.format(s)} ${timeFmt.format(s)} – ${dateShortFmt.format(e)} ${timeFmt.format(e)}`;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const future = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  let out: string;
  if (mins < 1) out = "just now";
  else if (mins < 60) out = `${mins}m`;
  else if (mins < 60 * 24) out = `${Math.round(mins / 60)}h`;
  else if (mins < 60 * 24 * 30) out = `${Math.round(mins / (60 * 24))}d`;
  else out = fmtDate(iso);
  if (out === "just now" || out === fmtDate(iso)) return out;
  return future ? `in ${out}` : `${out} ago`;
}

export function daysOverdue(expectedIso: string): number {
  return Math.max(1, Math.floor((Date.now() - new Date(expectedIso).getTime()) / 86_400_000));
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtCost(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/** Local value for <input type="datetime-local"> from an ISO string. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO string from an <input type="datetime-local"> value ("" → null). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Today's date for <input type="date"> defaults. */
export function todayDateInput(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
