import { createHmac, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";
import type pg from "pg";

export const sessionCookieName = "dealer_recon_session";

export type AuthRole =
  | "platform_admin"
  | "dealer_group_admin"
  | "store_manager"
  | "accounting_user"
  | "read_only_auditor";

export type AuthUser = {
  id: number;
  email: string;
  dealership_id: number;
  role: AuthRole;
  dealer_group_id: number | null;
  store_ids: number[];
};

export interface AuthRepository {
  findUserByEmail(email: string): Promise<(AuthUser & { password_hash: string }) | null>;
  findUserById(userId: number): Promise<AuthUser | null>;
}

export class MemoryAuthRepository implements AuthRepository {
  private users: Array<AuthUser & { password_hash: string }> = [];

  async addUser(input: {
    id?: number;
    email: string;
    password: string;
    dealership_id: number;
    role?: AuthRole;
    dealer_group_id?: number | null;
    store_ids?: number[];
  }) {
    const user = {
      id: input.id ?? this.users.length + 1,
      email: input.email.toLowerCase(),
      dealership_id: input.dealership_id,
      role: input.role ?? "platform_admin",
      dealer_group_id: input.dealer_group_id ?? null,
      store_ids: input.store_ids ?? [],
      password_hash: await hashPassword(input.password),
    };
    this.users.push(user);
    return toPublicUser(user);
  }

  async findUserByEmail(email: string) {
    const user = this.users.find((candidate) => candidate.email === email.toLowerCase());
    return user ? { ...user, store_ids: [...user.store_ids] } : null;
  }

  async findUserById(userId: number) {
    const user = this.users.find((candidate) => candidate.id === userId);
    return user ? toPublicUser(user) : null;
  }
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findUserByEmail(email: string) {
    const result = await this.pool.query<
      AuthUser & { password_hash: string; store_ids: number[] | null }
    >(
      `SELECT
        u.id,
        u.email,
        u.dealership_id,
        u.password_hash,
        COALESCE(u.role, 'accounting_user') AS role,
        u.dealer_group_id,
        COALESCE(array_agg(usa.dealership_store_id) FILTER (WHERE usa.dealership_store_id IS NOT NULL), '{}')::int[] AS store_ids
       FROM users u
       LEFT JOIN user_store_assignments usa ON usa.user_id = u.id
       WHERE lower(u.email) = lower($1)
       GROUP BY u.id`,
      [email],
    );
    return result.rows[0] ? normalizeUserRow(result.rows[0]) : null;
  }

  async findUserById(userId: number) {
    const result = await this.pool.query<AuthUser & { store_ids: number[] | null }>(
      `SELECT
        u.id,
        u.email,
        u.dealership_id,
        COALESCE(u.role, 'accounting_user') AS role,
        u.dealer_group_id,
        COALESCE(array_agg(usa.dealership_store_id) FILTER (WHERE usa.dealership_store_id IS NOT NULL), '{}')::int[] AS store_ids
       FROM users u
       LEFT JOIN user_store_assignments usa ON usa.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId],
    );
    return result.rows[0] ? normalizeUserRow(result.rows[0]) : null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

export function createSessionToken(
  user: AuthUser,
  sessionSecret: string,
  expiresAt = Date.now() + 8 * 60 * 60 * 1000,
): string {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sub: String(user.id),
    dealership_id: user.dealership_id,
    exp: Math.floor(expiresAt / 1000),
  });
  const signature = sign(`${header}.${payload}`, sessionSecret);
  return `${header}.${payload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  sessionSecret: string,
): { userId: number; dealershipId: number } | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    return null;
  }
  if (!safeEqual(sign(`${header}.${payload}`, sessionSecret), signature)) {
    return null;
  }

  const decoded = decodeJson(payload) as {
    sub?: unknown;
    dealership_id?: unknown;
    exp?: unknown;
  } | null;
  if (!decoded || typeof decoded.sub !== "string" || typeof decoded.exp !== "number") {
    return null;
  }
  if (decoded.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  const userId = Number(decoded.sub);
  if (
    !Number.isSafeInteger(userId) ||
    typeof decoded.dealership_id !== "number" ||
    !Number.isSafeInteger(decoded.dealership_id)
  ) {
    return null;
  }

  return { userId, dealershipId: decoded.dealership_id };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0].length > 0)
      .map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

function sign(value: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function encodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function toPublicUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    dealership_id: user.dealership_id,
    role: user.role,
    dealer_group_id: user.dealer_group_id,
    store_ids: [...user.store_ids],
  };
}

function normalizeUserRow<T extends AuthUser & { store_ids: number[] | null }>(row: T): T {
  return {
    ...row,
    role: row.role ?? "accounting_user",
    dealer_group_id: row.dealer_group_id ?? null,
    store_ids: row.store_ids ?? [],
  };
}
