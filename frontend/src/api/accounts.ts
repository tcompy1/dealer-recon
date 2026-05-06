import { apiGet } from "./client";
import type { AccountDetail, AccountSummary } from "../types/account";

export async function listAccountSummaries(): Promise<AccountSummary[]> {
  return apiGet<AccountSummary[]>("/accounts/summary");
}

export async function getAccountDetail(accountIdentifier: string): Promise<AccountDetail> {
  return apiGet<AccountDetail>(`/accounts/${encodeURIComponent(accountIdentifier)}`);
}
