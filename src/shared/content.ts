import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
export const orientationSchema = z.enum([
  "landscape",
  "landscape-180",
  "portrait-cw",
  "portrait-ccw",
]);
export type Orientation = z.infer<typeof orientationSchema>;
export const sportSchema = z.enum([
  "tennis",
  "pickleball",
  "squash",
  "badminton",
]);
export type Sport = z.infer<typeof sportSchema>;
export const elementSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["text", "image", "video", "rect", "qr", "clock"]),
  x: z.number().min(-1920).max(3840),
  y: z.number().min(-1920).max(3840),
  width: z.number().min(1).max(3840),
  height: z.number().min(1).max(3840),
  rotation: z.number().min(-360).max(360).default(0),
  text: z.string().max(2000).default(""),
  fill: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#122046"),
  fontSize: z.number().min(8).max(300).default(48),
  fontFamily: z
    .enum(["Cormorant Garamond", "Plus Jakarta Sans"])
    .default("Plus Jakarta Sans"),
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  assetId: z.string().uuid().optional(),
  brandAsset: z.enum(["crest", "tennis", "waterfront"]).optional(),
  binding: z.string().max(50).optional(),
  muted: z.boolean().default(true),
  loop: z.boolean().default(true),
  autoplay: z.boolean().default(true),
  fit: z.enum(["contain", "cover", "fill"]).default("contain").optional(),
});
export type Element = z.infer<typeof elementSchema>;
export const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    width: z.union([z.literal(1080), z.literal(1920)]),
    height: z.union([z.literal(1080), z.literal(1920)]),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    gradient: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    elements: z.array(elementSchema).max(100),
  })
  .refine((d) => d.width !== d.height, "Choose a portrait or landscape canvas");
export type DesignDocument = z.infer<typeof documentSchema>;
export const liveSchema = z.object({
  tournament: z.string().max(120),
  court: z.string().max(80),
  player1: z.string().max(120),
  player2: z.string().max(120),
  score1: z.string().max(20),
  score2: z.string().max(20),
  sets1: z.string().max(40),
  sets2: z.string().max(40),
  serving: z.enum(["1", "2", "none"]),
  serverNumber: z.enum(["1", "2"]).optional(),
  sport: sportSchema.default("tennis"),
  format: z.string().max(80).optional(),
  status: z.string().max(120),
  nextMatch: z.string().max(180),
});
export type LiveData = z.infer<typeof liveSchema>;
export const initialLive: LiveData = {
  sport: "tennis",
  tournament: "Club Championships",
  court: "Court 1",
  player1: "Player One",
  player2: "Player Two",
  score1: "0",
  score2: "0",
  sets1: "0",
  sets2: "0",
  serving: "none",
  status: "Ready to play",
  nextMatch: "",
};
export type Slide = {
  id: string;
  document: DesignDocument;
  duration: number;
  version: number;
  live?: LiveData;
  liveRevision?: number;
};
export type Manifest = {
  schemaVersion: 1;
  rendererVersion: 1;
  revision: string;
  assignmentId: string | null;
  contentId: string | null;
  version: number;
  orientation: Orientation;
  slides: Slide[];
  assets: Record<string, { url: string; sha256: string; mimeType?: string }>;
  epoch: number;
  live: boolean;
  commands: { id: string; kind: string }[];
};
export function canvasTransform(
  orientation: Orientation,
  viewportWidth: number,
  viewportHeight: number,
) {
  const isPortrait =
    orientation === "portrait-cw" || orientation === "portrait-ccw";
  return {
    width: isPortrait ? viewportHeight : viewportWidth,
    height: isPortrait ? viewportWidth : viewportHeight,
    rotation:
      orientation === "portrait-cw"
        ? 90
        : orientation === "portrait-ccw"
          ? -90
          : orientation === "landscape-180"
            ? 180
            : 0,
  };
}
export function playlistPosition(durations: number[], elapsedMs: number) {
  if (!durations.length) return { index: 0, remaining: 10000 };
  const total = durations.reduce((a, b) => a + b * 1000, 0);
  let t = ((elapsedMs % total) + total) % total;
  for (let i = 0; i < durations.length; i++) {
    const ms = durations[i] * 1000;
    if (t < ms) return { index: i, remaining: ms - t };
    t -= ms;
  }
  return { index: 0, remaining: 10000 };
}
export type AssignmentCandidate = {
  id: string;
  kind: "priority" | "schedule" | "normal" | "default";
  starts_at: string | Date;
  ends_at: string | Date | null;
  created_at: string | Date;
};
export function resolveAssignment<T extends AssignmentCandidate>(
  rows: T[],
  now = new Date(),
): T | undefined {
  const rank = { priority: 4, schedule: 3, normal: 2, default: 1 };
  return rows
    .filter(
      (a) =>
        new Date(a.starts_at) <= now &&
        (!a.ends_at || new Date(a.ends_at) > now),
    )
    .sort(
      (a, b) =>
        rank[b.kind] - rank[a.kind] ||
        +new Date(b.starts_at) - +new Date(a.starts_at) ||
        +new Date(b.created_at) - +new Date(a.created_at) ||
        b.id.localeCompare(a.id),
    )[0];
}
export function torontoTime(
  value: string,
  disambiguation: "reject" | "earlier" | "later" = "reject",
) {
  const input = Temporal.PlainDateTime.from(value);
  const zoned = input.toZonedDateTime("America/Toronto", { disambiguation });
  if (!zoned.toPlainDateTime().equals(input))
    throw new Error("This time does not exist in America/Toronto");
  return zoned.toInstant().toString();
}
export function uniqueTargets(screens: string[], groups: string[][]) {
  return [...new Set([...screens, ...groups.flat()])];
}
export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      +c ^
      ((typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
        ? crypto.getRandomValues(new Uint8Array(1))[0]
        : Math.floor(Math.random() * 256)) &
        (15 >> (+c / 4)))
    ).toString(16),
  );
}
export function makeElement(
  type: Element["type"],
  overrides: Partial<Element> = {},
): Element {
  return elementSchema.parse({
    id: generateUUID(),
    type,
    x: 100,
    y: 150,
    width: 880,
    height: 160,
    ...overrides,
  });
}
export function template(name: string, landscape = false): DesignDocument {
  const w = landscape ? 1920 : 1080,
    h = landscape ? 1080 : 1920;
  const text = (s: string, y: number, size = 70, binding?: string) =>
    makeElement("text", {
      text: s,
      x: 70,
      y,
      width: w - 140,
      height: size * 2.6,
      fontSize: size,
      fontFamily: "Cormorant Garamond",
      align: "center",
      binding,
    });
  const crest = makeElement("image", {
    x: w / 2 - (landscape ? 50 : 85),
    y: landscape ? 35 : 90,
    width: landscape ? 100 : 170,
    height: landscape ? 130 : 210,
    brandAsset: "crest",
  });
  let elements: Element[] = [
    crest,
    text("OPENSCREENS", landscape ? 205 : 340, 35),
    makeElement("rect", {
      x: w / 2 - 80,
      y: landscape ? 285 : 430,
      width: 160,
      height: 3,
      fill: "#c5a880",
    }),
  ];
  if (name === "Tournament welcome")
    elements.push(
      text("Welcome to the\nClub Championships", h * 0.36, landscape ? 96 : 92),
      text("A tradition of spirited competition", h * 0.65, 40),
      text("COMMUNITY & EVENTS", h * 0.83, 28),
    );
  else if (name === "Sponsor advertisement")
    elements.push(
      text("Our valued partners", h * 0.35, 86),
      text("YOUR SPONSOR", h * 0.55, 60),
      text("Proud supporters of our community", h * 0.8, 32),
    );
  else if (name === "Fullscreen image")
    elements = [
      makeElement("image", {
        x: 0,
        y: 0,
        width: w,
        height: h,
        brandAsset: "waterfront",
      }),
    ];
  else if (name === "Live tennis scoreboard") {
    elements = [
      crest,
      text("Club Championships", 330, 60, "tournament"),
      text("Court 1", 440, 38, "court"),
      text("Player One", h * 0.36, 64, "player1"),
      text("0", h * 0.43, 120, "score1"),
      text("0", h * 0.52, 36, "sets1"),
      text("Player Two", h * 0.6, 64, "player2"),
      text("0", h * 0.67, 120, "score2"),
      text("0", h * 0.76, 36, "sets2"),
      text("Ready to play", h * 0.84, 32, "status"),
      text("", h * 0.91, 26, "nextMatch"),
    ];
    if (landscape) {
      elements = [
        text("Club Championships", 30, 55, "tournament"),
        text("Court 1", 130, 30, "court"),
        ...["1", "2"].flatMap((n, i) => [
          makeElement("text", {
            text: "Player " + n,
            binding: "player" + n,
            x: 70 + i * 960,
            y: 330,
            width: 820,
            height: 130,
            fontSize: 70,
            align: "center",
          }),
          makeElement("text", {
            text: "0",
            binding: "score" + n,
            x: 70 + i * 960,
            y: 470,
            width: 820,
            height: 220,
            fontSize: 150,
            align: "center",
          }),
          makeElement("text", {
            text: "0",
            binding: "sets" + n,
            x: 70 + i * 960,
            y: 730,
            width: 820,
            height: 90,
            fontSize: 50,
            align: "center",
          }),
        ]),
        text("Ready to play", 880, 35, "status"),
        text("", 980, 25, "nextMatch"),
      ];
    }
  } else if (
    name === "Live pickleball scoreboard" ||
    name === "Live squash scoreboard" ||
    name === "Live badminton scoreboard"
  ) {
    const sportName =
      name === "Live pickleball scoreboard"
        ? "Pickleball"
        : name === "Live squash scoreboard"
          ? "Squash"
          : "Badminton";
    const defaultTournament = `Club ${sportName} Open`;
    const defaultCourt = `${sportName} Court 1`;
    const p1Label = sportName === "Pickleball" ? "Team One" : "Player One";
    const p2Label = sportName === "Pickleball" ? "Team Two" : "Player Two";

    elements = [
      crest,
      text(defaultTournament, 330, 60, "tournament"),
      text(defaultCourt, 440, 38, "court"),
      text(p1Label, h * 0.36, 64, "player1"),
      text("0", h * 0.43, 120, "score1"),
      text("0", h * 0.52, 36, "sets1"),
      text(p2Label, h * 0.6, 64, "player2"),
      text("0", h * 0.67, 120, "score2"),
      text("0", h * 0.76, 36, "sets2"),
      text("Ready to play", h * 0.84, 32, "status"),
      text("", h * 0.91, 26, "nextMatch"),
    ];
    if (landscape) {
      elements = [
        text(defaultTournament, 30, 55, "tournament"),
        text(defaultCourt, 130, 30, "court"),
        ...[
          { n: "1", label: p1Label },
          { n: "2", label: p2Label },
        ].flatMap(({ n, label }, i) => [
          makeElement("text", {
            text: label,
            binding: "player" + n,
            x: 70 + i * 960,
            y: 330,
            width: 820,
            height: 130,
            fontSize: 70,
            align: "center",
          }),
          makeElement("text", {
            text: "0",
            binding: "score" + n,
            x: 70 + i * 960,
            y: 470,
            width: 820,
            height: 220,
            fontSize: 150,
            align: "center",
          }),
          makeElement("text", {
            text: "0",
            binding: "sets" + n,
            x: 70 + i * 960,
            y: 730,
            width: 820,
            height: 90,
            fontSize: 50,
            align: "center",
          }),
        ]),
        text("Ready to play", 880, 35, "status"),
        text("", 980, 25, "nextMatch"),
      ];
    }
  } else
    elements.push(
      text("Around the Club", h * 0.36, 90),
      text("Your announcement goes here.", h * 0.57, 44),
      text("A community by the water", h * 0.83, 30),
    );
  return {
    schemaVersion: 1,
    width: w,
    height: h,
    background: "#faf8f5",
    elements,
  };
}
export const templateNames = [
  "Tournament welcome",
  "General announcement",
  "Sponsor advertisement",
  "Fullscreen image",
  "Live tennis scoreboard",
  "Live pickleball scoreboard",
  "Live squash scoreboard",
  "Live badminton scoreboard",
];
export type TournamentPreset = {
  id: string;
  sport: Sport;
  name: string;
  description: string;
  defaultCourtPrefix: string;
  scoreLabel: string;
  setsLabel: string;
  formatName: string;
};

export const tournamentPresets: TournamentPreset[] = [
  {
    id: "tennis-best-of-3",
    sport: "tennis",
    name: "Tennis · Best of 3 Sets",
    description:
      "Standard advantage or tiebreak sets (first to 6 games win by 2, 7-point tiebreak at 6-6).",
    defaultCourtPrefix: "Court",
    scoreLabel: "Current Game",
    setsLabel: "Sets",
    formatName: "Best of 3 Sets",
  },
  {
    id: "tennis-pro-set",
    sport: "tennis",
    name: "Tennis · 8-Game Pro Set",
    description: "Single extended set to 8 games, tiebreak at 7-7 or 8-8.",
    defaultCourtPrefix: "Court",
    scoreLabel: "Current Game",
    setsLabel: "Games Won",
    formatName: "8-Game Pro Set",
  },
  {
    id: "pickleball-sideout-11",
    sport: "pickleball",
    name: "Pickleball · Side-Out to 11",
    description:
      "Traditional side-out scoring to 11 (win by 2), doubles server 1 & 2 tracking.",
    defaultCourtPrefix: "Pickleball Court",
    scoreLabel: "Points",
    setsLabel: "Games",
    formatName: "Game to 11 (Win by 2)",
  },
  {
    id: "pickleball-rally-15",
    sport: "pickleball",
    name: "Pickleball · Rally Scoring to 15",
    description: "Point scored on every rally to 15 (win by 2).",
    defaultCourtPrefix: "Pickleball Court",
    scoreLabel: "Points",
    setsLabel: "Games",
    formatName: "Rally to 15 (Win by 2)",
  },
  {
    id: "squash-par-11",
    sport: "squash",
    name: "Squash · PAR-11 Best of 5",
    description:
      "Standard Point-A-Rally to 11 (win by 2), best of 5 games.",
    defaultCourtPrefix: "Squash Court",
    scoreLabel: "Current Game Points",
    setsLabel: "Games Won",
    formatName: "PAR-11 Best of 5",
  },
  {
    id: "squash-par-11-bo3",
    sport: "squash",
    name: "Squash · PAR-11 Best of 3",
    description: "Point-A-Rally to 11 (win by 2), best of 3 games.",
    defaultCourtPrefix: "Squash Court",
    scoreLabel: "Current Game Points",
    setsLabel: "Games Won",
    formatName: "PAR-11 Best of 3",
  },
  {
    id: "badminton-bwf-21",
    sport: "badminton",
    name: "Badminton · BWF Best of 3 (to 21)",
    description:
      "Rally scoring to 21 (win by 2, cap at 30), best of 3 games.",
    defaultCourtPrefix: "Badminton Court",
    scoreLabel: "Current Game Points",
    setsLabel: "Games Won",
    formatName: "BWF to 21 (Best of 3)",
  },
];
export const fallbackDocument = template("General announcement");
fallbackDocument.elements = fallbackDocument.elements.map((e) => ({
  ...e,
  text:
    e.text === "Around the Club"
      ? "Welcome to OpenScreens"
      : e.text === "Your announcement goes here."
        ? "Smart digital displays made simple."
        : e.text,
}));

// The club doesn't need the screens overnight, so TVs show a black screen
// between these Toronto hours.
export const QUIET_HOURS = { from: 22, until: 7 };
export const quietDocument: DesignDocument = {
  ...fallbackDocument,
  background: "#000000",
  gradient: undefined,
  elements: [],
};
export function quietHours(now = Date.now()) {
  const local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(
    "America/Toronto",
  );
  const quiet = local.hour >= QUIET_HOURS.from || local.hour < QUIET_HOURS.until;
  let next = local.withPlainTime({
    hour: quiet ? QUIET_HOURS.until : QUIET_HOURS.from,
  });
  if (next.epochMilliseconds <= now) next = next.add({ days: 1 });
  return { quiet, nextChange: next.epochMilliseconds };
}
