export type CurrentUser = {
  id: number;
  email: string;
  dealership_id: number;
};

export type AuthResponse = {
  user: CurrentUser;
};
