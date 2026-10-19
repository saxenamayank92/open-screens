import { config } from "dotenv";
config({ path: ".env.local" });
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool, transaction } from "../src/server/db";
await transaction(async (c) => {
  await c.query("SELECT pg_advisory_xact_lock(78019107)");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null default now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await readFile("migrations/" + name, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const result = await c.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (result.rowCount) {
      if (result.rows[0].checksum !== hash)
        throw new Error("Migration changed: " + name);
      continue;
    }
    await c.query(sql);
    await c.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
      [name, hash],
    );
    console.log("Applied", name);
  }
});
await pool().end();
