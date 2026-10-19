import { config } from "dotenv";
config({ path: ".env.local" });
import { pool, transaction } from "../src/server/db";
import { secret, hash } from "../src/server/auth";
import { sendAccountEmail } from "../src/server/email";
import { template, templateNames } from "../src/shared/content";
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
  throw new Error(
    "Usage: npm run admin:bootstrap -- administrator@example.com",
  );
const token = secret();
await transaction(async (c) => {
  await c.query("SELECT pg_advisory_xact_lock(78019108)");
  if ((await c.query("SELECT 1 FROM users LIMIT 1")).rowCount)
    throw new Error("Already initialized; invite staff in Settings.");
  let org = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0];
  if (!org)
    org = (
      await c.query(
        "INSERT INTO organizations(name) VALUES('Main Venue') RETURNING id",
      )
    ).rows[0];
  await c.query(
    "INSERT INTO account_tokens(organization_id,email,kind,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '48 hours')",
    [org.id, email, "invite", hash(token)],
  );
  for (const name of templateNames)
    await c.query(
      "INSERT INTO templates(id,name,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [name, name, JSON.stringify(template(name))],
    );
});
await sendAccountEmail(email, "invite", token);
console.log(
  "Invitation prepared. Check the configured mailbox or local development mail capture.",
);
await pool().end();
