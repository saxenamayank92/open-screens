import { query } from "./db";
import { assetUrl } from "./media";
import {
  resolveAssignment,
  fallbackDocument,
  quietDocument,
  quietHours,
  makeElement,
  type Manifest,
  type Slide,
  type Orientation,
} from "../shared/content";
export type DeviceManifest = {
  manifest: Manifest;
  storageKeys: Record<string, string>;
  validUntil: number;
};
// Signed media links expire after 5 minutes, so the cached copy keeps the
// storage keys and links are signed per request.
export async function signManifest({ manifest: m, storageKeys }: DeviceManifest) {
  const assets: Manifest["assets"] = {};
  for (const [id, a] of Object.entries(m.assets))
    assets[id] = { ...a, url: await assetUrl(id, storageKeys[id]) };
  return { ...m, assets };
}
export async function manifest(
  screen: Record<string, any>,
  withUrls = true,
  audience: "device" | "staff" = "device",
): Promise<Manifest> {
  const { manifest: m } = await buildManifest(screen, withUrls, audience);
  return m;
}
export async function buildManifest(
  screen: Record<string, any>,
  withUrls = true,
  audience: "device" | "staff" = "device",
): Promise<DeviceManifest> {
  const now = Date.now();
  const rows = await query(
    "SELECT * FROM assignments WHERE screen_id=$1 AND organization_id=$2 AND cancelled_at IS NULL",
    [screen.id, screen.organization_id],
  );
  const assignment = resolveAssignment(rows as any[], new Date(now)) as any;
  // The schedule can change which content is showing at the next start or end
  // time, so a cached copy must not outlive it.
  const quiet = audience === "device" ? quietHours(now) : null;
  const validUntil = Math.min(
    quiet?.nextChange ?? Infinity,
    ...rows
      .flatMap((r) => [r.starts_at, r.ends_at])
      .filter(Boolean)
      .map((t) => new Date(t).getTime())
      .filter((t) => t > now),
  );
  let slides: Slide[] = [
      { id: "fallback", document: fallbackDocument, duration: 60, version: 1 },
    ],
    version = 1,
    contentId: string | null = null,
    live = false,
    liveRevision = 0;
  if (assignment?.design_version_id) {
    const [v] = await query("SELECT * FROM design_versions WHERE id=$1", [
      assignment.design_version_id,
    ]);
    slides = [
      { id: v.id, document: v.document, duration: 60, version: v.version },
    ];
    version = v.version;
    contentId = v.design_id;
  }
  if (assignment?.playlist_version_id) {
    const [v] = await query("SELECT * FROM playlist_versions WHERE id=$1", [
      assignment.playlist_version_id,
    ]);
    slides = v.snapshot;
    version = v.version;
    contentId = v.playlist_id;
  }
  if (assignment?.live_board_id) {
    const [b] = await query(
      "SELECT l.*,v.document,v.version FROM live_boards l JOIN design_versions v ON v.id=l.design_version_id WHERE l.id=$1",
      [assignment.live_board_id],
    );
    slides = [
      {
        id: b.id,
        document: b.document,
        duration: 60,
        version: b.version,
        live: b.data,
        liveRevision: b.revision,
      },
    ];
    live = true;
    liveRevision = b.revision;
    version = b.version;
    contentId = b.id;
  }
  const assets: Manifest["assets"] = {};
  const storageKeys: Record<string, string> = {};
  const ids = [
    ...new Set(
      slides.flatMap((s) =>
        s.document.elements.flatMap((e) => (e.assetId ? [e.assetId] : [])),
      ),
    ),
  ];
  if (ids.length) {
    const media = await query(
      "SELECT id,storage_key,sha256,mime_type FROM media_assets WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [screen.organization_id, ids],
    );
    for (const m of media) {
      storageKeys[m.id] = m.storage_key;
      assets[m.id] = {
        url: withUrls
          ? audience === "staff"
            ? `/api/v1/media/${m.id}/file`
            : await assetUrl(m.id, m.storage_key)
          : "",
        sha256: m.sha256,
        mimeType: m.mime_type,
      };
    }
  }
  const commands = await query(
    "SELECT id,kind FROM device_commands WHERE screen_id=$1 AND acknowledged_at IS NULL ORDER BY created_at",
    [screen.id],
  );
  if (quiet?.quiet) {
    slides = [{ id: "quiet", document: quietDocument, duration: 60, version: 1 }];
    version = 1;
    contentId = null;
    live = false;
    liveRevision = 0;
    for (const id of Object.keys(assets)) delete assets[id];
  }
  const result: Manifest = {
    schemaVersion: 1,
    rendererVersion: 1,
    revision: quiet?.quiet
      ? `quiet:${screen.orientation}`
      : `${assignment?.id ?? "fallback"}:${version}:${liveRevision}:${screen.orientation}`,
    assignmentId: quiet?.quiet ? null : (assignment?.id ?? null),
    contentId,
    version,
    orientation: screen.orientation as Orientation,
    slides,
    assets,
    epoch: assignment && !quiet?.quiet ? new Date(assignment.starts_at).getTime() : 0,
    live,
    commands: commands as Manifest["commands"],
  };
  return { manifest: result, storageKeys, validUntil };
}
