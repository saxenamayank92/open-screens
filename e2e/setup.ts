import { request } from "@playwright/test";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
export default async function setup() {
  await mkdir(".local", { recursive: true });
  try {
    JSON.parse(await readFile(".local/e2e-auth.json", "utf8"));
    return;
  } catch {}
  const files = (await readdir(".local/mail"))
    .filter((f) => f.endsWith("-invite.json"))
    .sort();
  if (!files.length)
    throw new Error(
      "Bootstrap the isolated local administrator before E2E tests.",
    );
  const invite = JSON.parse(
    await readFile(".local/mail/" + files.at(-1), "utf8"),
  );
  const password = randomBytes(24).toString("hex");
  const context = await request.newContext({
    baseURL: "http://localhost:3100",
  });
  try {
    const response = await context.post("/api/v1/auth/accept", {
      headers: { origin: "http://localhost:3100" },
      data: {
        token: new URL(invite.url).searchParams.get("token"),
        name: "Pilot Administrator",
        password,
      },
    });
    if (!response.ok())
      throw new Error(
        "Local bootstrap invitation could not be accepted. Generate a new local invitation.",
      );
    await writeFile(
      ".local/e2e-auth.json",
      JSON.stringify({ email: invite.email, password }),
      { mode: 0o600 },
    );
  } finally {
    await context.dispose();
  }
}
