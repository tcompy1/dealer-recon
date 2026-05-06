import { apiGet, apiPost } from "./client";
import type { AuthResponse } from "../types/auth";

export async function login(email: string, password: string) {
  return apiPost<AuthResponse>("/login", { email, password });
}

export async function logout() {
  return apiPost<{ status: string }>("/logout", {});
}

export async function getMe() {
  return apiGet<AuthResponse>("/me");
}
