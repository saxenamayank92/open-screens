import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "./db";
import type { PoolClient } from "pg";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Actor = {
  user_id: string;
  organization_id: string;
  email: string;
  name: string;
  role: string;
};
export async function staff(request: Request): Promise<Actor> {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("openscreens_session="))
    ?.slice(20);
  if (!token) throw new HttpError(401, "Please sign in.");
  const [actor] = await query<Actor>(
    `SELECT s.user_id,s.organization_id,u.email,u.name,m.role FROM staff_sessions s JOIN users u ON u.id=s.user_id JOIN organization_members m ON m.user_id=u.id AND m.organization_id=s.organization_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL`,
    [hash(token)],
  );
  if (!actor) throw new HttpError(401, "Session expired. Please sign in.");
  if (actor.role !== "admin")
    throw new HttpError(403, "Administrator access required.");
  return actor;
}
export function checkOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const appOrigin = new URL(
    process.env.APP_URL || "http://localhost:3100",
  ).origin;
  if (origin === appOrigin) return;
  try {
    const u = new URL(origin);
    if (
      u.hostname.endsWith(".vercel.app")
    ) {
      return;
    }
  } catch {}
  if (process.env.NODE_ENV !== "production") {
    try {
      const u = new URL(origin);
      if (
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname.endsWith(".local") ||
        /^192\.168\./.test(u.hostname) ||
        /^10\./.test(u.hostname)
      ) {
        return;
      }
    } catch {}
  }
  throw new HttpError(403, "Request origin is not permitted.");
}
export async function device(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Device authorization required.");
  const [row] = await query(
    `SELECT s.*,d.id credential_id FROM device_credentials d JOIN screens s ON s.id=d.screen_id WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.deleted_at IS NULL`,
    [hash(token)],
  );
  if (!row) throw new HttpError(401, "Device is revoked or unpaired.");
  return row;
}
export async function rate(key: string, limit = 10, seconds = 300) {
  const [r] = await query(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.expires_at END RETURNING count`,
    [hash(key), seconds],
  );
  if (r.count > limit)
    throw new HttpError(429, "Too many attempts. Please try again later.");
}
export function ip(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0] ?? "local"
  );
}
export async function audit(
  a: Actor,
  action: string,
  id: string,
  details: unknown = {},
  c?: PoolClient,
) {
  await query(
    "INSERT INTO audit_logs(organization_id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [a.organization_id, a.user_id, action, id, JSON.stringify(details)],
    c,
  );
}
export async function passwordHash(password: string) {
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw new HttpError(
      400,
      "Use a password of at least 12 characters and at most 72 bytes.",
    );
  return bcrypt.hash(password, 12);
}
export const cookie = (token: string, maxAge = 86400 * 7) =>
  `openscreens_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
