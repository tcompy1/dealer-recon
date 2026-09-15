export type AccountingMonth = string & {
  readonly __accountingMonth: unique symbol;
};

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
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function parseAccountingMonth(value: unknown): AccountingMonth | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = ACCOUNTING_MONTH_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1 || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  return value as AccountingMonth;
}

export function formatAccountingMonth(month: AccountingMonth): string {
  const [year, monthNumber] = splitAccountingMonth(month);
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

export function accountingMonthEndDate(month: AccountingMonth): string {
  const [year, monthNumber] = splitAccountingMonth(month);
  const baseDays = DAYS_IN_MONTH[monthNumber - 1];
  const days = monthNumber === 2 && isLeapYear(year) ? 29 : baseDays;
  return `${month}-${String(days).padStart(2, "0")}`;
}

function splitAccountingMonth(month: AccountingMonth): [number, number] {
  const [year, monthNumber] = month.split("-").map(Number);
  return [year, monthNumber];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
