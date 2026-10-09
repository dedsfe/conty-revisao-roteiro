export const BRAND_TIME_ZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRAND_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Dia civil (YYYY-MM-DD) de um instante, no fuso da marca.
export function civilDayInBrandZone(instant: Date): string {
  return formatter.format(instant);
}

// Aceita só datas reais no formato YYYY-MM-DD (rejeita 2026-02-30, 2026-13-01, etc.).
export function isValidCivilDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}
