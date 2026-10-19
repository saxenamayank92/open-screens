import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("upload, validate, reuse and preview an image slideshow", async ({
  page,
}) => {
  const auth = JSON.parse(await readFile(".local/e2e-auth.json", "utf8"));
  await page.goto("/login");
  await page.getByLabel("Email address").fill(auth.email);
  await page.getByLabel("Password", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your club. On display." }),
  ).toBeVisible();
  await page.goto("/content");
  await page.getByRole("button", { name: "images", exact: true }).click();
  await page
    .getByLabel("Image description", { exact: true })
    .fill("Club crest for pilot upload verification");
  await page.getByLabel("Upload image").setInputFiles("public/brand/crest.png");
  await expect(page.getByRole("status")).toContainText("Image ready", {
    timeout: 15000,
  });
  const state = await (await page.request.get("/api/v1/state")).json();
  const image = state.media.find(
    (m: any) => m.description === "Club crest for pilot upload verification",
  );
  expect(image.width).toBeGreaterThan(0);
  await page.getByRole("button", { name: "playlists", exact: true }).click();
  const name = "Pilot slideshow " + Date.now();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByLabel("Add a published design or image")
    .selectOption("image:" + image.id);
  await page.getByRole("button", { name: "Save slideshow version" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Slideshow version published",
  );
  const row = page.locator(".activity").filter({ hasText: name });
  await row.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Slideshow preview" })
      .locator("canvas")
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  const removal = await page.request.delete("/api/v1/media/" + image.id, {
    headers: { origin: "http://localhost:3100" },
  });
  expect(removal.status()).toBe(409);
});
