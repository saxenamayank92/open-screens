import { config } from "dotenv";
config({ path: ".env.local" });
import { pool, query, transaction } from "../src/server/db";
import { passwordHash } from "../src/server/auth";

const email =
  process.argv[2]?.trim().toLowerCase() || "admin@example.com";
const password = process.argv[3] || "OpenScreens2026!";
const name = process.argv[4] || "System Administrator";

(async () => {
  const ph = await passwordHash(password);
  await transaction(async (c) => {
    let [org] = (await c.query("SELECT id FROM organizations LIMIT 1")).rows;
    if (!org) {
      org = (
        await c.query(
          "INSERT INTO organizations(name) VALUES('Main Venue') RETURNING id",
        )
      ).rows[0];
    }
    const [existing] = (
      await c.query("SELECT id FROM users WHERE email=$1", [email])
    ).rows;
    let userId = existing?.id;
    if (existing) {
      await c.query("UPDATE users SET password_hash=$1, name=$2 WHERE id=$3", [
        ph,
        name,
        userId,
      ]);
      console.log(`Updated user ${email}`);
    } else {
      const [u] = (
        await c.query(
          "INSERT INTO users(email, name, password_hash) VALUES($1,$2,$3) RETURNING id",
          [email, name, ph],
        )
      ).rows;
      userId = u.id;
      await c.query(
        "INSERT INTO organization_members(organization_id, user_id, role) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING",
        [org.id, userId],
      );
      console.log(`Created admin user ${email}`);
    }
  });
  console.log(`Login ready:\n  Email: ${email}\n  Password: ${password}`);
  await pool().end();
})();
