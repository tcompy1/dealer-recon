const centsScale = 100;

export function parseAmountToCents(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  let normalized = value.trim().replace(/^"|"$/g, "").trim();
  let isNegative = false;

  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    isNegative = true;
    normalized = normalized.slice(1, -1).trim();
  }

  normalized = normalized.replace(/\$/g, "").replace(/,/g, "").trim();
  if (normalized.startsWith("-")) {
    isNegative = true;
    normalized = normalized.slice(1);
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [dollars, fractional = ""] = normalized.split(".");
  const cents = Number(`${dollars}${fractional.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    return null;
  }

  return isNegative ? -cents : cents;
}

export function formatCents(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const absoluteCents = Math.abs(amountCents);
  const dollars = Math.floor(absoluteCents / centsScale);
  const cents = String(absoluteCents % centsScale).padStart(2, "0");
  return `${sign}${dollars}.${cents}`;
}
