import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, transaction } from "./db";
import {
  cookie,
  hash,
  secret,
  rate,
  ip,
  passwordHash,
  HttpError,
  staff,
  audit,
} from "./auth";
import { sendAccountEmail } from "./email";
export async function accountApi(request: Request, path: string[]) {
  if (request.method !== "POST")
    throw new HttpError(405, "Use POST for account actions.");
  const action = path[0];
  const body = request.method === "POST" ? await request.json() : {};
  if (action === "login") {
    const b = z
      .object({ email: z.email(), password: z.string().max(200) })
      .parse(body);
    await rate("login-ip:" + ip(request), 40);
    await rate("login-account:" + b.email.toLowerCase(), 8);
    const [u] = await query(
      "SELECT u.*,m.organization_id FROM users u JOIN organization_members m ON m.user_id=u.id WHERE email=$1 AND disabled_at IS NULL",
      [b.email.toLowerCase()],
    );
    if (
      !u?.password_hash ||
      !(await bcrypt.compare(b.password, u.password_hash))
    )
      throw new HttpError(401, "Email or password is incorrect.");
    await query("DELETE FROM rate_limits WHERE key=$1", [
      hash("login-account:" + b.email.toLowerCase()),
    ]);
    const token = secret();
    await query(
      "INSERT INTO staff_sessions(token_hash,user_id,organization_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [hash(token), u.id, u.organization_id],
    );
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": cookie(token) } },
    );
  }
  if (action === "logout") {
    const t = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)openscreens_session=([^;]+)/)?.[1];
    if (t)
      await query("DELETE FROM staff_sessions WHERE token_hash=$1", [hash(t)]);
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": cookie("", 0) } },
    );
  }
  if (action === "accept") {
    const b = z
      .object({
        token: z.string().min(20).max(200),
        name: z.string().min(1).max(100),
        password: z.string().min(12).max(72),
      })
      .parse(body);
    await rate("accept:" + ip(request), 20);
    const ph = await passwordHash(b.password);
    await transaction(async (c) => {
      const [t] = await query(
        "SELECT * FROM account_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(b.token)],
        c,
      );
      if (!t)
        throw new HttpError(
          400,
          "This link has expired or has already been used.",
        );
      let [u] = await query("SELECT * FROM users WHERE email=$1", [t.email], c);
      if (t.kind === "invite" && u?.password_hash)
        throw new HttpError(
          400,
          "This account already exists. Use password recovery.",
        );
      if (!u)
        [u] = await query(
          "INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING *",
          [t.email, b.name, ph],
          c,
        );
      else
        await query(
          "UPDATE users SET password_hash=$1,name=$2 WHERE id=$3",
          [ph, b.name, u.id],
          c,
        );
      await query(
        "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING",
        [t.organization_id, u.id],
        c,
      );
      await query(
        "UPDATE account_tokens SET used_at=now() WHERE email=$1 AND used_at IS NULL",
        [t.email],
        c,
      );
      await query("DELETE FROM staff_sessions WHERE user_id=$1", [u.id], c);
    });
    return { ok: true };
  }
  if (action === "invite" || action === "reset") {
    const b = z.object({ email: z.email() }).parse(body);
    const email = b.email.toLowerCase();
    await rate("email:" + ip(request) + ":" + email, 5, 3600);
    let org: string;
    let actor;
    if (action === "invite") {
      actor = await staff(request);
      org = actor.organization_id;
      const exists = await query("SELECT 1 FROM users WHERE email=$1", [email]);
      if (exists.length)
        throw new HttpError(409, "This email already has an account.");
    } else {
      const [u] = await query(
        "SELECT m.organization_id FROM users u JOIN organization_members m ON m.user_id=u.id WHERE u.email=$1 AND u.disabled_at IS NULL",
        [email],
      );
      if (!u) return { ok: true };
      org = u.organization_id;
    }
    const token = secret();
    const [t] = await query(
      "INSERT INTO account_tokens(organization_id,email,kind,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 minute') RETURNING id",
      [org, email, action, hash(token), action === "invite" ? 2880 : 30],
    );
    let emailSent = false;
    let emailError: string | null = null;
    let inviteUrl = "";
    try {
      const emailResult = await sendAccountEmail(email, action, token);
      emailSent = emailResult.sent;
      inviteUrl = emailResult.url;
      if (!emailSent && emailResult.reason) emailError = emailResult.reason;
    } catch (e) {
      emailError = (e as Error).message;
      inviteUrl = `${process.env.APP_URL || "http://localhost:3100"}/account?token=${token}`;
      console.error(JSON.stringify({ event: `${action}_email_failed`, error: emailError }));
    }
    if (actor) await audit(actor, "staff.invite", t.id);
    return { ok: true, emailSent, inviteUrl, error: emailError };
  }
  throw new HttpError(404, "Not found");
}
