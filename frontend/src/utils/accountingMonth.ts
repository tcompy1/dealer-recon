const ACCOUNTING_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function isAccountingMonth(value: string): boolean {
  const match = ACCOUNTING_MONTH_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && month >= 1 && month <= 12;
}

export function formatAccountingMonth(value: string): string {
  if (!isAccountingMonth(value)) {
    return value;
  }

  const [year, month] = value.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}
