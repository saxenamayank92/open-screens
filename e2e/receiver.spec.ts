import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { template, type Manifest } from "../src/shared/content";
const origin = "https://appassets.androidplatform.net";
function fixture(orientation: Manifest["orientation"] = "landscape"): Manifest {
  return {
    schemaVersion: 1,
    rendererVersion: 1,
    revision: "fixture:1:" + orientation,
    assignmentId: null,
    contentId: null,
    version: 1,
    orientation,
    slides: [
      {
        id: "welcome",
        document: template("Tournament welcome"),
        duration: 2,
        version: 1,
      },
      {
        id: "announcement",
        document: template("General announcement"),
        duration: 2,
        version: 1,
      },
    ],
    assets: {},
    epoch: Date.now(),
    live: false,
    commands: [],
  };
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    (window as any).__messages = [];
    (window as any).Screens = {
      postMessage: (raw: string) =>
        (window as any).__messages.push(JSON.parse(raw)),
    };
  });
  await page.route(origin + "/**", async (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname.startsWith("/fonts/")
      ? url.pathname.slice(1)
      : url.pathname.replace("/assets/renderer/", "");
    if (relative.includes("..")) return route.abort();
    try {
      const body = await readFile(
        path.join("android/app/src/main/assets/renderer", relative),
      );
      const ext = path.extname(relative);
      await route.fulfill({
        body,
        contentType:
          (
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".woff2": "font/woff2",
            } as any
          )[ext] || "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
  await page.goto(origin + "/assets/renderer/index.html");
  await page.waitForFunction(
    () => typeof (window as any).receiveManifest === "function",
  );
});
test("packaged renderer acknowledges both slideshow items and keeps looping offline", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const m = fixture();
  await page.evaluate((m) => (window as any).receiveManifest(m), m);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).__messages
            .filter((x: any) => x.type === "render")
            .map((x: any) => x.slideId),
        ),
      { timeout: 8000 },
    )
    .toContain("welcome");
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).__messages
            .filter((x: any) => x.type === "render")
            .map((x: any) => x.slideId),
        ),
      { timeout: 8000 },
    )
    .toContain("announcement");
  await context.setOffline(true);
  const count = await page.evaluate(
    () =>
      (window as any).__messages.filter((x: any) => x.type === "render").length,
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).__messages.filter((x: any) => x.type === "render")
              .length,
        ),
      { timeout: 8000 },
    )
    .toBeGreaterThan(count);
  expect(errors).toEqual([]);
});
for (const orientation of ["portrait-cw", "portrait-ccw"] as const)
  test("packaged renderer transforms " + orientation, async ({ page }) => {
    const m = fixture(orientation);
    m.slides = m.slides.slice(0, 1);
    await page.evaluate((m) => (window as any).receiveManifest(m), m);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__messages.some(
            (x: any) => x.type === "render" && x.slideId === "welcome",
          ),
        ),
      )
      .toBe(true);
    const transform = await page
      .locator("#root>div>div")
      .evaluate((e) => ({
        width: (e as HTMLElement).style.width,
        height: (e as HTMLElement).style.height,
        transform: (e as HTMLElement).style.transform,
      }));
    expect(transform.width).toBe("1080px");
    expect(transform.height).toBe("1920px");
    expect(transform.transform).toContain(
      orientation === "portrait-cw" ? "rotate(90deg)" : "rotate(-90deg)",
    );
    await page.screenshot({
      path: "artifacts/receiver-" + orientation + ".png",
    });
  });
test("unsupported renderer version preserves last valid scene", async ({
  page,
}) => {
  const m = fixture();
  m.slides = m.slides.slice(0, 1);
  await page.evaluate((m) => (window as any).receiveManifest(m), m);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__messages.some(
          (x: any) => x.type === "render" && x.slideId === "welcome",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(
    (m) =>
      (window as any).receiveManifest({
        ...m,
        revision: "incompatible",
        rendererVersion: 99,
      }),
    m,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__messages.some(
          (x: any) =>
            x.type === "error" && x.message === "Renderer update required",
        ),
      ),
    )
    .toBe(true);
  expect(await page.locator("canvas").count()).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      (window as any).__messages.some(
        (x: any) => x.type === "render" && x.revision === "incompatible",
      ),
    ),
  ).toBe(false);
});
