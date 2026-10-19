import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
test("dashboard, studio, pairing and mobile live controls meet WCAG AA checks", async ({
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
  for (const route of ["/", "/studio", "/pair", "/live"]) {
    await page.goto(route);
    await expect(page.locator("#main-content h1")).toBeVisible();
    if (route === "/live")
      await page.setViewportSize({ width: 390, height: 844 });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .exclude("nextjs-portal")
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
