import { test, expect } from "@playwright/test";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { template } from "../src/shared/content";
const runId = Date.now().toString();
const screenName = "Tennis Pavilion · Test " + runId;
const boardName = "Pilot court " + runId;
let browserErrors: string[] = [];
let email = "pilot-admin@example.test",
  password = "",
  deviceToken = "",
  screenId = "",
  versionId = "";
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => {
  await mkdir(".local", { recursive: true });
  try {
    const auth = JSON.parse(await readFile(".local/e2e-auth.json", "utf8"));
    password = auth.password;
    email = auth.email;
  } catch {
    password = randomBytes(20).toString("hex");
    const files = (await readdir(".local/mail"))
      .filter((x) => x.endsWith("-invite.json"))
      .sort();
    const invite = JSON.parse(
      await readFile(".local/mail/" + files.at(-1), "utf8"),
    );
    email = invite.email;
    const token = new URL(invite.url).searchParams.get("token");
    const result = await request.post("/api/v1/auth/accept", {
      headers: { origin: "http://localhost:3100" },
      data: { token, name: "Pilot Administrator", password },
    });
    expect(result.ok(), await result.text()).toBeTruthy();
    await writeFile(
      ".local/e2e-auth.json",
      JSON.stringify({ email, password }),
    );
  }
});
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /TypeError|ReactKonva|Hydration/.test(m.text()))
      browserErrors.push(m.text());
  });
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your club. On display." }),
  ).toBeVisible();
});
test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});
test("dashboard branding and protected navigation", async ({
  page,
  request,
}) => {
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  const unauth = await request.get("/api/v1/state");
  expect(unauth.status()).toBe(401);
  expect((await page.request.get("/")).headers()["x-robots-tag"]).toContain(
    "noindex",
  );
});
test("pair an outgoing device and show online heartbeat", async ({
  page,
  request,
}) => {
  deviceToken = randomBytes(32).toString("base64url");
  const challenge = randomBytes(32).toString("base64url");
  const reg = await request.post("/api/v1/device/register", {
    data: { token: deviceToken, challenge },
  });
  expect(reg.ok()).toBeTruthy();
  const { code } = await reg.json();
  await page.goto("/pair");
  await page.getByLabel("Pairing code").fill(code);
  await page.getByLabel("Screen name").fill(screenName);
  await page.getByLabel("Location", { exact: true }).fill("Court 1");
  await page.getByLabel("Six-digit local reset PIN").fill("654321");
  await page
    .getByRole("button", { name: "Connect screen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your screen is connected" }),
  ).toBeVisible();
  const state = await (await page.request.get("/api/v1/state")).json();
  screenId = state.screens.find((s: any) => s.name === screenName).id;
  const beat = await request.post("/api/v1/device/heartbeat", {
    headers: { authorization: "Bearer " + deviceToken },
    data: {
      appVersion: "test-receiver",
      resolution: "1920x1080",
      rendererVersion: 1,
    },
  });
  expect(beat.ok()).toBeTruthy();
  await page.goto("/screens/" + screenId);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
});
test("create, edit and publish an immutable studio design", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(
    page.getByRole("heading", { name: "Content studio" }),
  ).toBeVisible();
  await page.getByLabel("Design name").fill("Pilot welcome");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Published version");
  const state = await (await page.request.get("/api/v1/state")).json();
  versionId = state.versions.find((v: any) => v.name === "Pilot welcome").id;
  await page.screenshot({
    path: "artifacts/studio-desktop.png",
    fullPage: true,
  });
});
test("publish and receive a matching render acknowledgement", async ({
  page,
  request,
}) => {
  await page.goto("/content");
  await page
    .getByRole("button", { name: "Publish to screens", exact: true })
    .click();
  await page
    .getByLabel("Published content")
    .selectOption("design:" + versionId);
  await page.getByRole("checkbox", { name: new RegExp(screenName) }).check();
  await page
    .getByRole("button", { name: "Publish to 1 screen", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Content assigned");
  const sync = await request.get("/api/v1/device/sync", {
    headers: { authorization: "Bearer " + deviceToken },
  });
  const m = await sync.json();
  expect(m.slides[0].id).toBe(versionId);
  const ack = await request.post("/api/v1/device/ack", {
    headers: { authorization: "Bearer " + deviceToken },
    data: {
      revision: m.revision,
      assignmentId: m.assignmentId,
      contentId: m.contentId,
      version: m.version,
      slideId: m.slides[0].id,
      rendererVersion: 1,
      renderedAt: new Date().toISOString(),
    },
  });
  expect(ack.ok()).toBeTruthy();
  await page.goto("/screens/" + screenId);
  await expect(
    page.getByText(m.revision, { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/display?screen=" + screenId);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/portrait-preview.png" });
});
test("manual live score saving and mobile layout", async ({ page }) => {
  const headers = { origin: "http://localhost:3100" };
  const draft = await (
    await page.request.post("/api/v1/designs", {
      headers,
      data: {
        name: "Pilot scoreboard",
        document: template("Live tennis scoreboard"),
      },
    })
  ).json();
  const version = await (
    await page.request.post("/api/v1/designs/" + draft.id + "/publish", {
      headers,
      data: {},
    })
  ).json();
  await page.request.post("/api/v1/live", {
    headers,
    data: { name: boardName, versionId: version.id },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/live");
  await page
    .getByLabel("Live board", { exact: true })
    .selectOption({ label: boardName });
  await page.getByLabel("Player / team one", { exact: true }).fill("Alex");
  await page.getByLabel("Current game · one", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Save scores to screens" }).click();
  await expect(page.getByRole("status")).toContainText("Live scores updated");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/live-mobile.png", fullPage: true });
});
test("revocation denies subsequent device access", async ({
  page,
  request,
}) => {
  await page.request.post("/api/v1/screens/" + screenId + "/revoke", {
    headers: { origin: "http://localhost:3100" },
    data: {},
  });
  expect(
    (
      await request.get("/api/v1/device/sync", {
        headers: { authorization: "Bearer " + deviceToken },
      })
    ).status(),
  ).toBe(401);
});
