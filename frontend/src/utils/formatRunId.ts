import { formatAccountingMonth } from "./accountingMonth";

export function formatRunId(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${year}`;
}

export function formatRunIdentity(
  profileId: string,
  accountingMonth: string,
  runId: number,
): string {
  const rooftop = profileId.replace(/-v\d+$/i, "").toUpperCase();
  return `${rooftop} · ${formatAccountingMonth(accountingMonth)} · Run #${runId}`;
}
