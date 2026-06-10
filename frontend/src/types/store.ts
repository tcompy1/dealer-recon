export type DealerGroup = {
  id: number;
  dealership_id: number;
  name: string;
  created_at: string;
};

export type DealershipStore = {
  id: number;
  dealership_id: number;
  dealer_group_id: number | null;
  name: string;
  created_at: string;
};

export type DealerGroupAnalytics = {
  dealer_group_id: number | null;
  dealer_group_name: string;
  stores: Array<{
    dealership_store_id: number | null;
    store_name: string;
    run_count: number;
    unresolved_count: number;
    recurring_exception_count: number;
  }>;
};
