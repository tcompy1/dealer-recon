import type { AuthUser } from "../auth.js";
import type { TransactionRepository } from "../repositories/transactionRepository.js";

export function hasAnyRole(user: AuthUser, roles: AuthUser["role"][]): boolean {
  return roles.includes(user.role);
}

export function canWrite(user: AuthUser): boolean {
  return user.role !== "read_only_auditor";
}

export async function canAccessStore(
  repository: TransactionRepository,
  user: AuthUser,
  storeId: number | null,
): Promise<boolean> {
  if (user.role === "platform_admin") {
    return true;
  }
  if (storeId === null) {
    return true;
  }
  if (user.role === "dealer_group_admin") {
    const store = (await repository.listDealershipStores(user.dealership_id)).find(
      (candidate) => candidate.id === storeId,
    );
    return Boolean(store && store.dealer_group_id === user.dealer_group_id);
  }
  return user.store_ids.includes(storeId);
}

export async function filterByStoreAccess<T>(
  repository: TransactionRepository,
  user: AuthUser,
  items: T[],
  getStoreId: (item: T) => number | null,
): Promise<T[]> {
  const visibleItems: T[] = [];
  for (const item of items) {
    if (await canAccessStore(repository, user, getStoreId(item))) {
      visibleItems.push(item);
    }
  }
  return visibleItems;
}

export function filterStoresForUser<T extends { id: number; dealer_group_id: number | null }>(
  user: AuthUser,
  stores: T[],
): T[] {
  if (user.role === "platform_admin") {
    return stores;
  }
  if (user.role === "dealer_group_admin") {
    return stores.filter((store) => store.dealer_group_id === user.dealer_group_id);
  }
  return stores.filter((store) => user.store_ids.includes(store.id));
}
