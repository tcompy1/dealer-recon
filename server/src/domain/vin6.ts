const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/;
const looseVinPattern = /[A-HJ-NPR-Z0-9]{6,}/i;

export function computeVin6(vin: string | null | undefined): string | null {
  if (!vin) {
    return null;
  }
  const upper = vin.toUpperCase().trim();
  if (!upper) {
    return null;
  }

  const match = upper.match(vinPattern);
  if (match) {
    return match[0].slice(-6);
  }

  if (upper.length >= 6 && looseVinPattern.test(upper)) {
    return upper.slice(-6);
  }

  return null;
}

export function extractVin6FromDescription(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }
  const match = description.toUpperCase().match(vinPattern);
  return match ? match[0].slice(-6) : null;
}
