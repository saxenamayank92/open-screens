import { z } from "zod";
import { randomInt } from "node:crypto";
import { query, transaction } from "./db";
import { hash, secret, rate, ip, device, HttpError } from "./auth";
import { buildManifest, signManifest, type DeviceManifest } from "./manifest";
import {
  SYNC_TTL_S,
  HEARTBEAT_SAVE_MS,
  getSync,
  setSync,
  dropSync,
  lastExpiry,
  expireScreen,
  getHeartbeat,
  setHeartbeat,
  getLastError,
  setLastError,
} from "./screen-cache";
type SyncEntry = {
  screen: Record<string, any>;
  sync: DeviceManifest;
  builtAt: number;
  expiresAt: number;
};
// Authenticates the TV and returns its content without touching the database
// unless the cached copy was cleared by a staff change or a schedule boundary.
export async function cachedDevice(request: Request): Promise<SyncEntry> {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Device authorization required.");
  const key = hash(token);
  const cached = await getSync<SyncEntry>(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const builtAt = Date.now();
  const screen = await device(request);
  const sync = await buildManifest(screen, false);
  const expiresAt = Math.min(builtAt + SYNC_TTL_S * 1000, sync.validUntil);
  const entry = { screen, sync, builtAt, expiresAt };
  if (expiresAt - Date.now() >= 1000 && (await lastExpiry()) < builtAt) {
    await setSync(key, screen.id, entry, (expiresAt - Date.now()) / 1000);
    if ((await lastExpiry()) >= builtAt) await dropSync(key);
  }
  return entry;
}

export async function deviceApi(request: Request, path: string[]) {
  const action = path[0];
  if (action === "register" && request.method === "POST") {
    await rate("register:" + ip(request), 20, 3600);
    const b = z
      .object({
        challenge: z.string().min(40).max(100),
        token: z.string().min(40).max(100),
      })
      .parse(await request.json());
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "OAK-";
    for (let i = 0; i < 6; i++) code += alphabet[randomInt(alphabet.length)];
    await query(
      "INSERT INTO pairing_codes(code_hash,challenge_hash,device_token_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
      [hash(code), hash(b.challenge), hash(b.token)],
    );
    return { code, expiresAt: new Date(Date.now() + 300000).toISOString() };
  }
  if (action === "pair-status") {
    const challenge =
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    await rate("pair-status:" + hash(challenge), 80, 60);
    const [p] = await query(
      "SELECT claimed_at,expires_at FROM pairing_codes WHERE challenge_hash=$1",
      [hash(challenge)],
    );
    if (!p) throw new HttpError(404, "Pairing request not found");
    return {
      paired: !!p.claimed_at,
      expired: !p.claimed_at && new Date(p.expires_at) < new Date(),
    };
  }
  const { screen: s, sync } = await cachedDevice(request);
  if (action === "unpair" && request.method === "POST") {
    await transaction(async (c) => {
      await query(
        "UPDATE device_credentials SET revoked_at=now() WHERE id=$1",
        [s.credential_id],
        c,
      );
      await query("UPDATE screens SET revoked_at=now() WHERE id=$1", [s.id], c);
      await query(
        "INSERT INTO audit_logs(organization_id,action,entity_id) VALUES($1,'device.local_reset',$2)",
        [s.organization_id, s.id],
        c,
      );
    });
    await expireScreen(s.id);
    return { ok: true };
  }
  if (action === "config" && request.method === "GET")
    return { resetPinHash: s.reset_pin_hash };
  if (action === "sync" && request.method === "GET") {
    const m = await signManifest(sync);
    const etag = '"' + m.revision + '"';
    if (request.headers.get("if-none-match") === etag && !m.commands.length)
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "public, max-age=10, stale-while-revalidate=15" },
      });
    return Response.json(m, {
      headers: { ETag: etag, "Cache-Control": "public, max-age=10, stale-while-revalidate=15" },
    });
  }
  if (action === "heartbeat" && request.method === "POST") {
    const b = z
      .object({
        appVersion: z.string().max(80),
        resolution: z.string().max(50),
        rendererVersion: z.number().int().min(1),
        error: z.string().max(500).optional(),
      })
      .parse(await request.json());
    const now = Date.now();
    const previous = await getHeartbeat(s.id);
    const hb = {
      at: new Date(now).toISOString(),
      savedAt: previous?.savedAt ?? 0,
      appVersion: b.appVersion,
      resolution: b.resolution,
      rendererVersion: b.rendererVersion,
    };
    // Live status comes from the cache; the database copy is only refreshed
    // every few hours or when something about the TV changes.
    if (
      now - hb.savedAt >= HEARTBEAT_SAVE_MS ||
      b.error ||
      previous?.appVersion !== b.appVersion ||
      previous?.resolution !== b.resolution ||
      previous?.rendererVersion !== b.rendererVersion
    ) {
      await transaction(async (c) => {
        await query(
          "UPDATE screens SET last_heartbeat=now(),app_version=$1,resolution=$2,renderer_version=$3 WHERE id=$4",
          [b.appVersion, b.resolution, b.rendererVersion, s.id],
          c,
        );
        await query(
          "INSERT INTO device_heartbeats(screen_id,app_version) VALUES($1,$2)",
          [s.id, b.appVersion],
          c,
        );
      });
      hb.savedAt = now;
    }
    await setHeartbeat(s.id, hb);
    return { ok: true };
  }
  if (action === "ack" && request.method === "POST") {
    const b = z
      .object({
        revision: z.string().max(200),
        assignmentId: z.string().uuid().nullable(),
        contentId: z.string().uuid().nullable(),
        version: z.number().int(),
        slideId: z.string().max(100),
        rendererVersion: z.literal(1),
        liveRevision: z.number().int().optional(),
        renderedAt: z.string().datetime(),
      })
      .parse(await request.json());
    const current = sync.manifest;
    if (
      b.revision !== current.revision ||
      b.assignmentId !== current.assignmentId ||
      b.contentId !== current.contentId ||
      b.version !== current.version ||
      !current.slides.some(
        (x) =>
          x.id === b.slideId && (x.liveRevision ?? 0) === (b.liveRevision ?? 0),
      )
    )
      return { ok: false, stale: true };
    await transaction(async (c) => {
      await query(
        "INSERT INTO render_acknowledgements(screen_id,revision,payload) VALUES($1,$2,$3)",
        [s.id, b.revision, JSON.stringify(b)],
        c,
      );
      await query(
        "UPDATE screens SET last_ack=$1,last_error=NULL WHERE id=$2",
        [JSON.stringify({ ...b, receivedAt: new Date().toISOString() }), s.id],
        c,
      );
    });
    return { ok: true };
  }
  if (action === "error" && request.method === "POST") {
    const b = z
      .object({
        message: z.string().max(500),
        revision: z.string().max(200).optional(),
      })
      .parse(await request.json());
    // A TV stuck on the same error reports it every couple of seconds; only
    // record it when it changes or once an hour.
    if ((await getLastError(s.id))?.message !== b.message) {
      await query("UPDATE screens SET last_error=$1 WHERE id=$2", [
        JSON.stringify({ ...b, at: new Date().toISOString() }),
        s.id,
      ]);
      await setLastError(s.id, b.message);
    }
    return { ok: true };
  }
  if (action === "command" && request.method === "POST") {
    const b = z.object({ id: z.string().uuid() }).parse(await request.json());
    await query(
      "UPDATE device_commands SET acknowledged_at=now() WHERE id=$1 AND screen_id=$2",
      [b.id, s.id],
    );
    await expireScreen(s.id);
    return { ok: true };
  }
  throw new HttpError(404, "Not found");
}
