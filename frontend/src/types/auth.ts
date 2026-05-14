export type CurrentUser = {
  id: number;
  email: string;
  dealership_id: number;
  role:
    | "platform_admin"
    | "dealer_group_admin"
    | "store_manager"
    | "accounting_user"
    | "read_only_auditor";
  dealer_group_id: number | null;
  store_ids: number[];
};

export type AuthResponse = {
  user: CurrentUser;
};
