/** Storage compatibility: old rows/writers have only the six-decimal amount. */
export interface StoredUsageCost {
  cost_usd: number | string | null;
  cost_usd_precise?: number | string | null;
}

const USD_SCALE = 1_000_000_000_000n;
const MAX_ROW_UNITS = 100_000_000n * USD_SCALE;

/** PostgREST keeps these field names but returns the stored decimal text, not a rounded JS number. */
export const USAGE_COST_COLUMNS = "cost_usd::text, cost_usd_precise::text";

/** Sum recorded decimal amounts as integer units, without binary floating-point drift. */
export function recordedUsageUnits(row: StoredUsageCost): bigint | null {
  const value = row.cost_usd_precise ?? row.cost_usd;
  if (value === null) return null;
  const text = String(value);
  // Both stored numerics have at most eight integer and twelve fractional digits.
  // The extra representation room permits a sign/scientific notation, never unbounded input.
  if (text.length > 64) throw new RangeError("Recorded usage amount exceeds its storage representation");
  const parsed = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!parsed) throw new Error("Invalid recorded usage amount");
  const fraction = parsed[3] ?? "";
  const exponent = Number(parsed[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) throw new RangeError("Invalid recorded usage exponent");
  const digitText = parsed[2] + fraction;
  const digits = BigInt(digitText);
  if (digits === 0n) return 0n;
  const shift = 12 + exponent - fraction.length;
  if (shift >= 20) throw new RangeError("Recorded usage amount exceeds its integer range");
  if (shift < -digitText.length) return 0n;
  const factor = 10n ** BigInt(Math.abs(shift));
  const units = shift >= 0 ? digits * factor : (digits + factor / 2n) / factor;
  if (units >= MAX_ROW_UNITS) throw new RangeError("Recorded usage amount exceeds its integer range");
  return parsed[1] === "-" ? -units : units;
}

/** Convert only after aggregation; BigInt never enters the public JSON DTO. */
export function usageUnitsUsd(units: bigint): number {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  return Number(`${negative ? "-" : ""}${absolute / USD_SCALE}.${String(absolute % USD_SCALE).padStart(12, "0")}`);
}

/** Prefer a recorded precise zero too; never reprice historical rows from today's rates. */
export function recordedUsageCost(row: StoredUsageCost): number | null {
  const units = recordedUsageUnits(row);
  return units === null ? null : usageUnitsUsd(units);
}

/** Keep sub-microdollar amounts until consumers have aggregated them. */
export const roundUsageUsd = (value: number): number => Math.round(value * 1e12) / 1e12;
