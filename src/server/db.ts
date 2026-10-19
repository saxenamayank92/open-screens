import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
const globalDb = globalThis as unknown as { ocPool?: Pool };
export function pool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return (globalDb.ocPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  }));
}
export function database() {
  return drizzle(pool());
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  client?: PoolClient,
) {
  return (await (client ?? pool()).query<T>(text, values)).rows;
}
export async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
