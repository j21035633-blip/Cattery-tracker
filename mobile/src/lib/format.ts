import type { TaskType } from "./types";

/** ISO weekday labels: index 1 = Monday, matching the API's days_of_week. */
export const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const TASK_LABELS: Record<TaskType, string> = {
  feeding: "Feeding",
  cleaning: "Cleaning",
  vet: "Vet",
  vaccination: "Vaccination",
  medication: "Medication",
};

export function formatTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export function formatDate(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });
}

export function formatDateTime(iso: string, timeZone?: string): string {
  return `${formatDate(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

/** "3h 20m", "45 min", "2d" — matches the wording the digest uses. */
export function humaniseMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const leftover = hours % 24;
  return leftover ? `${days}d ${leftover}h` : `${days}d`;
}

export function relativeToNow(iso: string): string {
  const diffMinutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Math.abs(diffMinutes) < 1) return "just now";
  return diffMinutes > 0
    ? `${humaniseMinutes(diffMinutes)} ago`
    : `in ${humaniseMinutes(Math.abs(diffMinutes))}`;
}

export function formatWeight(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return "—";
  return `${(grams / 1000).toFixed(2)} kg`;
}

export function formatWeightDelta(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return "—";
  const sign = grams > 0 ? "+" : grams < 0 ? "−" : "";
  return `${sign}${Math.abs(grams / 1000).toFixed(2)} kg`;
}

export function describeDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && days.every((d) => d <= 5)) return "Weekdays";
  if (days.length === 2 && days.includes(6) && days.includes(7)) return "Weekends";
  return days.map((day) => WEEKDAYS[day]).join(", ");
}

/** "07:30:00" -> "07:30" */
export function trimSeconds(time: string): string {
  return time.slice(0, 5);
}

export function catAge(dateOfBirth: string | null): string | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  const months =
    (new Date().getFullYear() - born.getFullYear()) * 12 +
    (new Date().getMonth() - born.getMonth());
  if (months < 1) return "newborn";
  if (months < 24) return `${months} mo`;
  return `${Math.floor(months / 12)} yr`;
}

/** The device's IANA zone, used to pre-fill signup. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Parse a hand-typed date. React Native has no date picker built in, so the
 * forms take `YYYY-MM-DD` (optionally with `HH:MM`) and validate it here.
 */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = "09", minute = "00"] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "07:30" typed by hand -> the "07:30:00" the API expects. */
export function normaliseTimeInput(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}:00`;
}
