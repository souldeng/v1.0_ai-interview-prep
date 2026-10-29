/** DeepSeek: Mon–Fri 09:00–12:00 and 14:00–18:00 Asia/Shanghai,
 * excluding Chinese public holidays. Weekends remain off-peak even on make-up workdays.
 * Sources checked 2026-10-24:
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
 * Maintain this calendar annually; an unknown year's possible peak hours stay unknown.
 */
const holidayRanges: Record<string, Array<[string, string]>> = {
  "2026": [["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"], ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"]],
};
export type BillingPeriod = "peak" | "off_peak" | "unknown" | "custom";
export const CALENDAR_VERSION = "CN-public-holidays-2026-gbfmd-2025-7";
export const BILLING_TIMEZONE = "Asia/Shanghai";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: BILLING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function shanghaiClock(date: Date) {
  const parts = formatter.formatToParts(date);
  const value = (key: string) => parts.find(part => part.type === key)!.value;
  const day = `${value("year")}-${value("month")}-${value("day")}`;
  return { day, year: value("year"), monthDay: `${value("month")}-${value("day")}`, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

export function deepseekPeriod(date: Date): BillingPeriod {
  if (!Number.isFinite(date.getTime())) return "unknown";
  const local = shanghaiClock(date);
  // UTC at local midnight is the previous day: derive weekday from the local date itself.
  const weekday = new Date(`${local.day}T12:00:00+08:00`).getUTCDay();
  if (weekday === 0 || weekday === 6 || !(local.minutes >= 540 && local.minutes < 720 || local.minutes >= 840 && local.minutes < 1080)) return "off_peak";
  const holidays = holidayRanges[local.year];
  if (!holidays) return "unknown";
  return holidays.some(([from, to]) => local.monthDay >= from && local.monthDay <= to) ? "off_peak" : "peak";
}

/** Include every tariff boundary, rather than assuming identical endpoints mean one tariff. */
export function billingCheckpoints(startedAt: string, completedAt: string): Date[] | null {
  const start = new Date(startedAt), end = new Date(completedAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start || end.getTime() - start.getTime() > 366 * 86400_000) return null;
  const dates = [start, end];
  const midnight = Date.parse(`${shanghaiClock(start).day}T00:00:00+08:00`);
  for (let day = midnight; day <= end.getTime(); day += 86400_000) for (const hour of [0, 9, 12, 14, 18]) {
    const time = day + hour * 3600_000;
    if (time > start.getTime() && time < end.getTime()) dates.push(new Date(time));
  }
  return dates;
}
