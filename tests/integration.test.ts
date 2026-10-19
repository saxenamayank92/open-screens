import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { config } from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import { pool, query } from "../src/server/db";
import { hash, secret, staff, device } from "../src/server/auth";
import { staffApi } from "../src/server/staff-api";
import { deviceApi } from "../src/server/device-api";
import { template, quietHours } from "../src/shared/content";
// TVs show a blank screen overnight, so content checks only run in the day.
const daytime = !quietHours().quiet;
config({ path: ".env.local" });
const testUrl = process.env.TEST_DATABASE_URL;
let session = "",
  org = "",
  other = "",
  screen = "",
  version = "",
  token = "",
  challenge = "",
  code = "";
const req = (method: string, body?: unknown, auth = session) =>
  new Request("http://localhost:3100/api/v1/test", {
    method,
    headers: {
      cookie: "openscreens_session=" + auth,
      authorization: "Bearer " + token,
      origin: "http://localhost:3100",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
describe.skipIf(!testUrl)("isolated PostgreSQL integration", () => {
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/openscreens_test")
    )
      throw new Error(
        "Tests require an isolated local openscreens_test database",
      );
    process.env.DATABASE_URL = testUrl!;
    await query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const migrationFiles = (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of migrationFiles) {
      await query(await readFile("migrations/" + f, "utf8"));
    }
    org = (
      await query(
        "INSERT INTO organizations(name) VALUES('Test club') RETURNING id",
      )
    )[0].id;
    other = (
      await query(
        "INSERT INTO organizations(name) VALUES('Other club') RETURNING id",
      )
    )[0].id;
    const u = (
      await query(
        "INSERT INTO users(email,name) VALUES('test@example.test','Test Admin') RETURNING id",
      )
    )[0].id;
    await query(
      "INSERT INTO organization_members(organization_id,user_id) VALUES($1,$2)",
      [org, u],
    );
    session = secret();
    await query(
      "INSERT INTO staff_sessions(token_hash,user_id,organization_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hash(session), u, org],
    );
  }, 30000);
  afterAll(async () => {
    await pool().end();
  });
  it("rejects missing staff authorization", async () => {
    await expect(staff(new Request("http://localhost"))).rejects.toMatchObject({
      status: 401,
    });
  });
  it("pairs a code exactly once under concurrent claims", async () => {
    token = secret();
    challenge = secret();
    const registration = (await deviceApi(req("POST", { token, challenge }), [
      "register",
    ])) as any;
    code = registration.code;
    const payload = {
      code,
      name: "Court TV",
      location: "Tennis",
      orientation: "portrait-cw",
      resetPin: "123456",
    };
    const results = await Promise.allSettled([
      staffApi(req("POST", payload), ["pair"]),
      staffApi(req("POST", payload), ["pair"]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    screen = (
      results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>
    ).value.id;
    expect((await device(req("GET"))).id).toBe(screen);
  });
  it("rejects expired pairing codes", async () => {
    const r = (await deviceApi(
      req("POST", { token: secret(), challenge: secret() }),
      ["register"],
    )) as any;
    await query(
      "UPDATE pairing_codes SET expires_at=now()-interval '1 second' WHERE code_hash=$1",
      [hash(r.code)],
    );
    await expect(
      staffApi(
        req("POST", {
          code: r.code,
          name: "Expired",
          location: "",
          orientation: "landscape",
          resetPin: "123456",
        }),
        ["pair"],
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("publishes immutable versions and isolates drafts", async () => {
    const d = (await staffApi(
      req("POST", {
        name: "Welcome",
        document: template("Tournament welcome"),
      }),
      ["designs"],
    )) as any;
    const v = (await staffApi(req("POST", {}), [
      "designs",
      d.id,
      "publish",
    ])) as any;
    version = v.id;
    await staffApi(
      req("PATCH", {
        name: "Changed draft",
        document: template("General announcement"),
        revision: 1,
      }),
      ["designs", d.id],
    );
    expect(
      (
        await query("SELECT document FROM design_versions WHERE id=$1", [
          version,
        ])
      )[0].document,
    ).toEqual(v.document);
    await expect(
      query("UPDATE design_versions SET version=99 WHERE id=$1", [version]),
    ).rejects.toThrow("immutable");
  });
  it.skipIf(!daytime)("publishes deduplicated screen targets and returns protected manifests", async () => {
    const result = (await staffApi(
      req("POST", {
        contentType: "design",
        contentId: version,
        screens: [screen, screen],
        kind: "normal",
      }),
      ["publish"],
    )) as any;
    expect(result.targets).toBe(1);
    const response = (await deviceApi(req("GET"), ["sync"])) as Response;
    const m = await response.json();
    expect(m.contentId).toBeTruthy();
    expect(m.slides[0].document.elements.length).toBeGreaterThan(0);
  });
  it("acknowledges only current rendered versions", async () => {
    const m = await (
      (await deviceApi(req("GET"), ["sync"])) as Response
    ).json();
    const body = {
      revision: m.revision,
      assignmentId: m.assignmentId,
      contentId: m.contentId,
      version: m.version,
      slideId: m.slides[0].id,
      rendererVersion: 1,
      renderedAt: new Date().toISOString(),
    };
    expect(
      await deviceApi(req("POST", { ...body, revision: "stale" }), ["ack"]),
    ).toMatchObject({ stale: true });
    expect(await deviceApi(req("POST", body), ["ack"])).toMatchObject({
      ok: true,
    });
    expect(
      (await query("SELECT last_ack FROM screens WHERE id=$1", [screen]))[0]
        .last_ack.revision,
    ).toBe(m.revision);
  });
  it("prevents overlapping schedules even under concurrent publishing", async () => {
    const body = {
      contentType: "design",
      contentId: version,
      screens: [screen],
      kind: "schedule",
      startsAt: "2030-07-01T12:00:00Z",
      endsAt: "2030-07-01T14:00:00Z",
    };
    const r = await Promise.allSettled([
      staffApi(req("POST", body), ["publish"]),
      staffApi(req("POST", body), ["publish"]),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
  it("denies another organization screen access", async () => {
    const foreign = (
      await query(
        "INSERT INTO screens(organization_id,name) VALUES($1,'Private') RETURNING id",
        [other],
      )
    )[0].id;
    await expect(
      staffApi(req("GET"), ["screens", foreign, "manifest"]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      staffApi(
        req("POST", {
          contentType: "design",
          contentId: version,
          screens: [foreign],
          kind: "normal",
        }),
        ["publish"],
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("rejects concurrent stale scoreboard writes and retains history", async () => {
    const b = (await staffApi(
      req("POST", { name: "Court", versionId: version }),
      ["live"],
    )) as any;
    await staffApi(
      req("PATCH", { data: { ...b.data, score1: "15" }, revision: 1 }),
      ["live", b.id],
    );
    await expect(
      staffApi(
        req("PATCH", { data: { ...b.data, score1: "30" }, revision: 1 }),
        ["live", b.id],
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await query("SELECT * FROM live_board_updates WHERE live_board_id=$1", [
          b.id,
        ])
      ).length,
    ).toBe(1);
  });
  it("serves routine TV polls without touching the database", async () => {
    const heartbeat = {
      appVersion: "0.1.0",
      resolution: "1920x1080",
      rendererVersion: 1,
    };
    await deviceApi(req("GET"), ["sync"]);
    await deviceApi(req("POST", heartbeat), ["heartbeat"]);
    const queries = vi.spyOn(pool(), "query");
    const connects = vi.spyOn(pool(), "connect");
    try {
      for (let i = 0; i < 5; i++) {
        expect(((await deviceApi(req("GET"), ["sync"])) as Response).status).toBe(200);
        await deviceApi(req("POST", heartbeat), ["heartbeat"]);
      }
      await deviceApi(req("GET"), ["config"]);
      expect(queries).not.toHaveBeenCalled();
      expect(connects).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
      connects.mockRestore();
    }
    const state = (await staffApi(req("GET"), ["state"])) as any;
    const s = state.screens.find((x: any) => x.id === screen);
    expect(Date.now() - new Date(s.last_heartbeat).getTime()).toBeLessThan(5000);
  });
  it("shows staff changes on the TV's next poll", async () => {
    const sync = async () =>
      ((await deviceApi(req("GET"), ["sync"])) as Response).json();
    const original = (await sync()).orientation;
    const flipped = original === "landscape" ? "portrait-cw" : "landscape";
    await staffApi(
      req("PATCH", { name: "Lobby", location: "", orientation: flipped }),
      ["screens", screen],
    );
    expect((await sync()).orientation).toBe(flipped);
    await staffApi(
      req("PATCH", { name: "Lobby", location: "", orientation: original }),
      ["screens", screen],
    );
    expect((await sync()).orientation).toBe(original);
  });
  it.skipIf(!daytime)("switches content at a scheduled start time without staff action", async () => {
    const sync = async () =>
      ((await deviceApi(req("GET"), ["sync"])) as Response).json();
    const before = await sync();
    await staffApi(
      req("POST", {
        contentType: "design",
        contentId: version,
        screens: [screen],
        kind: "schedule",
        startsAt: new Date(Date.now() + 2500).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
      ["publish"],
    );
    expect((await sync()).revision).toBe(before.revision);
    await new Promise((r) => setTimeout(r, 3000));
    expect((await sync()).revision).not.toBe(before.revision);
  });
  it("revokes credentials and keeps logical screen assignments", async () => {
    await staffApi(req("POST", {}), ["screens", screen, "revoke"]);
    await expect(device(req("GET"))).rejects.toMatchObject({ status: 401 });
    await expect(deviceApi(req("GET"), ["sync"])).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (await query("SELECT * FROM assignments WHERE screen_id=$1", [screen]))
        .length,
    ).toBeGreaterThan(0);
  });
});
