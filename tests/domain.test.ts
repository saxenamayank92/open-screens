import { describe, it, expect } from "vitest";
import {
  canvasTransform,
  playlistPosition,
  resolveAssignment,
  torontoTime,
  uniqueTargets,
  documentSchema,
  liveSchema,
  template,
  templateNames,
} from "../src/shared/content";
import { quietHours } from "../src/shared/content";
import { checkOrigin } from "../src/server/auth";
import { validateImage } from "../src/server/media";
import sharp from "sharp";
describe("display contracts", () => {
  it("transforms the full TV output in both directions", () => {
    expect(canvasTransform("portrait-cw", 1920, 1080)).toEqual({
      width: 1080,
      height: 1920,
      rotation: 90,
    });
    expect(canvasTransform("portrait-ccw", 1920, 1080).rotation).toBe(-90);
    expect(canvasTransform("landscape", 1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
      rotation: 0,
    });
    expect(canvasTransform("landscape-180", 1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
      rotation: 180,
    });
  });
  it("advances playlists on exact boundaries and loops", () => {
    expect(playlistPosition([10, 20], 9999).index).toBe(0);
    expect(playlistPosition([10, 20], 10000)).toEqual({
      index: 1,
      remaining: 20000,
    });
    expect(playlistPosition([10, 20], 30000).index).toBe(0);
    expect(playlistPosition([10, 20], -1).index).toBe(1);
  });
  it("resolves priority then schedule then normal then fallback", () => {
    const make = (kind: any, id: string, ends_at: string | null = null) => ({
      id,
      kind,
      starts_at: "2026-01-01T00:00:00Z",
      ends_at,
      created_at: "2026-01-01T00:00:00Z",
    });
    const rows = [
      make("default", "d"),
      make("normal", "n"),
      make("schedule", "s"),
      make("priority", "p", "2026-06-01T00:00:00Z"),
    ];
    expect(resolveAssignment(rows, new Date("2026-05-01"))?.id).toBe("p");
    expect(resolveAssignment(rows, new Date("2026-06-01"))?.id).toBe("s");
    expect(
      resolveAssignment(rows.slice(0, 2), new Date("2026-06-01"))?.id,
    ).toBe("n");
  });
  it("deduplicates overlapping screen groups", () =>
    expect(
      uniqueTargets(
        ["a"],
        [
          ["a", "b"],
          ["b", "c"],
        ],
      ),
    ).toEqual(["a", "b", "c"]));
  it("blanks screens from 10 PM to 7 AM Toronto time, across DST changes", () => {
    const at = (iso: string) => quietHours(Date.parse(iso));
    // 9:59 PM EDT, 10:00 PM EDT, 6:59 AM EDT, 7:00 AM EDT
    expect(at("2026-10-17T01:59:00Z")).toEqual({ quiet: false, nextChange: Date.parse("2026-10-17T02:00:00Z") });
    expect(at("2026-10-17T02:00:00Z")).toEqual({ quiet: true, nextChange: Date.parse("2026-10-17T11:00:00Z") });
    expect(at("2026-10-17T10:59:00Z").quiet).toBe(true);
    expect(at("2026-10-17T11:00:00Z")).toEqual({ quiet: false, nextChange: Date.parse("2026-10-18T02:00:00Z") });
    // Clocks fall back overnight Nov 1: wakes at 7 AM EST
    expect(at("2026-11-01T03:00:00Z").nextChange).toBe(Date.parse("2026-11-01T12:00:00Z"));
    // Clocks spring forward overnight Mar 14: wakes at 7 AM EDT
    expect(at("2027-03-14T03:00:00Z").nextChange).toBe(Date.parse("2027-03-14T11:00:00Z"));
  });
  it("uses Toronto time and rejects daylight-saving gaps and overlaps", () => {
    expect(torontoTime("2026-07-01T12:00")).toBe("2026-07-01T16:00:00Z");
    expect(torontoTime("2026-01-01T12:00")).toBe("2026-01-01T17:00:00Z");
    expect(() => torontoTime("2026-03-08T02:30")).toThrow();
    expect(() => torontoTime("2026-03-08T02:30", "later")).toThrow();
    expect(() => torontoTime("2026-11-01T01:30")).toThrow();
    expect(torontoTime("2026-11-01T01:30", "later")).toBe(
      "2026-11-01T06:30:00Z",
    );
  });
  it("all starter templates validate in both orientations", () => {
    for (const name of templateNames)
      for (const landscape of [true, false])
        expect(
          documentSchema.safeParse(template(name, landscape)).success,
        ).toBe(true);
  });
  it("validates live schema for all racquet sports", () => {
    const sports = ["tennis", "pickleball", "squash", "badminton"] as const;
    for (const sport of sports) {
      const parsed = liveSchema.parse({
        tournament: "Club Open",
        court: "Court 1",
        player1: "Player One",
        player2: "Player Two",
        score1: "11",
        score2: "9",
        sets1: "2",
        sets2: "1",
        serving: "1",
        serverNumber: sport === "pickleball" ? "2" : undefined,
        sport,
        format: "Best of 3",
        status: "In Progress",
        nextMatch: "Next: Match B",
      });
      expect(parsed.sport).toBe(sport);
      if (sport === "pickleball") {
        expect(parsed.serverNumber).toBe("2");
      }
    }
  });
  it("rejects cross-origin staff mutations", () => {
    expect(() =>
      checkOrigin(
        new Request("http://localhost", {
          method: "POST",
          headers: { origin: "https://untrusted.example" },
        }),
      ),
    ).toThrow();
  });
});
describe("image validation", () => {
  it("rejects SVG external resources and scripts", async () => {
    await expect(
      validateImage(Buffer.from("<svg><script>alert(1)</script></svg>")),
    ).rejects.toThrow();
    await expect(
      validateImage(
        Buffer.from('<svg><image href="https://example.com/a.png"/></svg>'),
      ),
    ).rejects.toThrow();
  });
  it("rejects malformed files", async () => {
    await expect(validateImage(Buffer.from("not an image"))).rejects.toThrow();
  });
  it("normalizes images and records dimensions/checksums", async () => {
    const source = await sharp({
      create: { width: 80, height: 40, channels: 3, background: "#122046" },
    })
      .png()
      .toBuffer();
    const image = await validateImage(source);
    expect(image.width).toBe(80);
    expect(image.height).toBe(40);
    expect(image.sha256).toHaveLength(64);
    expect((await sharp(image.data).metadata()).format).toBe("webp");
  });
});
