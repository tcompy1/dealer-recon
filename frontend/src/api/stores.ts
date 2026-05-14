import { apiGet, apiPost } from "./client";
import type { DealerGroup, DealerGroupAnalytics, DealershipStore } from "../types/store";

export async function listDealerGroups(): Promise<DealerGroup[]> {
  return apiGet<DealerGroup[]>("/dealer-groups");
}

export async function listDealershipStores(): Promise<DealershipStore[]> {
  return apiGet<DealershipStore[]>("/stores");
}

export async function createDealershipStore(input: {
  name: string;
  dealer_group_id?: number | null;
}): Promise<DealershipStore> {
  return apiPost<DealershipStore>("/stores", input);
}

export async function getDealerGroupAnalytics(): Promise<DealerGroupAnalytics[]> {
  return apiGet<DealerGroupAnalytics[]>("/dealer-groups/analytics");
}
