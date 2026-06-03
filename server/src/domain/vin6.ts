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

const vinCharPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

// Dealertrack description format: "DESCRIPTION_TEXT   MM/DD/YY  VIN17".
// The VIN is always the last whitespace-delimited token and always 17 chars.
// Prefer the trailing token so customer last names or dealer transfer names in
// the prefix can never be mistaken for the VIN. Fall back to the first embedded
// 17-char VIN only when the trailing token is not a clean VIN (defensive).
export function extractVin6FromDescription(description: string | null | undefined): string | null {
  if (!description) {
    return null;
  }
  const upper = description.toUpperCase().trim();
  if (!upper) {
    return null;
  }

  const tokens = upper.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  if (lastToken && vinCharPattern.test(lastToken)) {
    return lastToken.slice(-6);
  }

  const match = upper.match(vinPattern);
  return match ? match[0].slice(-6) : null;
}
