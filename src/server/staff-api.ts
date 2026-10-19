import { z } from "zod";
import bcrypt from "bcryptjs";
import { query, transaction, database } from "./db";
import { organizations } from "./schema";
import { eq } from "drizzle-orm";
import { staff, audit, HttpError, hash, rate, ip } from "./auth";
import {
  documentSchema,
  orientationSchema,
  liveSchema,
  initialLive,
  makeElement,
  type Slide,
  type DesignDocument,
} from "../shared/content";
import { manifest } from "./manifest";
import { withLiveHeartbeat, expireScreens } from "./screen-cache";
import { uploadTicket, finishUpload, putObject, getObject, hasS3 } from "./media";
import type { PoolClient } from "pg";
const uuid = z.string().uuid();
export async function staffApi(request: Request, path: string[]) {
  try {
    return await handleStaff(request, path);
  } finally {
    // Any staff change may affect what a TV shows, so TVs re-read the
    // database on their next poll. Cleared even on failure, in case part of
    // the change was saved.
    if (request.method !== "GET") await expireScreens();
  }
}
async function handleStaff(request: Request, path: string[]) {
  const a = await staff(request),
    org = a.organization_id,
    [resource, id, operation] = path;
  const read = request.method === "GET";
  const body =
    !read && request.method !== "DELETE" && resource !== "media"
      ? await request.json()
      : {};
  if (resource === "state" && read) {
    const [
      screens,
      designs,
      versions,
      playlists,
      groups,
      boards,
      media,
      assignments,
      history,
      members,
      templates,
    ] = await Promise.all([
      query(
        "SELECT * FROM screens WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at",
        [org],
      ),
      query(
        "SELECT * FROM designs WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC",
        [org],
      ),
      query(
        "SELECT v.*,d.name FROM design_versions v JOIN designs d ON d.id=v.design_id WHERE v.organization_id=$1 ORDER BY v.created_at DESC",
        [org],
      ),
      query(
        "SELECT p.*,COALESCE((SELECT jsonb_agg(i ORDER BY i.position) FROM playlist_items i WHERE i.playlist_id=p.id),'[]') items FROM playlists p WHERE p.organization_id=$1 AND deleted_at IS NULL",
        [org],
      ),
      query(
        "SELECT g.*,COALESCE((SELECT jsonb_agg(m.screen_id) FROM screen_group_members m WHERE m.group_id=g.id),'[]') screens FROM screen_groups g WHERE organization_id=$1",
        [org],
      ),
      query(
        "SELECT * FROM live_boards WHERE organization_id=$1 ORDER BY updated_at DESC",
        [org],
      ),
      query(
        "SELECT id,name,description,width,height,byte_size,created_at FROM media_assets WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
        [org],
      ),
      query(
        "SELECT * FROM assignments WHERE organization_id=$1 AND cancelled_at IS NULL ORDER BY starts_at DESC",
        [org],
      ),
      query(
        "SELECT l.*,u.name actor_name FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE l.organization_id=$1 ORDER BY l.created_at DESC LIMIT 100",
        [org],
      ),
      query(
        "SELECT u.id,u.email,u.name,u.disabled_at FROM users u JOIN organization_members m ON m.user_id=u.id WHERE m.organization_id=$1",
        [org],
      ),
      query("SELECT * FROM templates ORDER BY name"),
    ]);
    return {
      actor: a,
      organization: (
        await database()
          .select()
          .from(organizations)
          .where(eq(organizations.id, org))
      )[0],
      screens: await Promise.all(
        screens.map(({ reset_pin_hash, ...s }) => withLiveHeartbeat(s)),
      ),
      designs,
      versions,
      playlists,
      groups,
      boards,
      media,
      assignments,
      history,
      members,
      templates,
    };
  }
  if (resource === "pair" && request.method === "POST") {
    const b = z
      .object({
        code: z.string().max(20),
        name: z.string().trim().min(1).max(100),
        location: z.string().max(100),
        orientation: orientationSchema,
        replaceScreenId: uuid.optional(),
        resetPin: z.string().regex(/^\d{6}$/),
      })
      .parse(body);
    await rate("claim:" + a.user_id, 10, 300);
    const pin = await bcrypt.hash(b.resetPin, 10);
    return transaction(async (c) => {
      const [p] = await query(
        "SELECT * FROM pairing_codes WHERE code_hash=$1 AND claimed_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(b.code.trim().toUpperCase())],
        c,
      );
      if (!p)
        throw new HttpError(
          400,
          "Pairing code expired, already used, or incorrect.",
        );
      let s;
      if (b.replaceScreenId) {
        [s] = await query(
          "UPDATE screens SET name=$1,location=$2,orientation=$3,reset_pin_hash=$4,revoked_at=NULL,last_ack=NULL,last_heartbeat=NULL,last_error=NULL,updated_at=now() WHERE id=$5 AND organization_id=$6 AND deleted_at IS NULL RETURNING *",
          [b.name, b.location, b.orientation, pin, b.replaceScreenId, org],
          c,
        );
        if (!s) throw new HttpError(404, "Screen not found");
        await query(
          "UPDATE device_credentials SET revoked_at=now() WHERE screen_id=$1",
          [s.id],
          c,
        );
      } else
        [s] = await query(
          "INSERT INTO screens(organization_id,name,location,orientation,reset_pin_hash) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [org, b.name, b.location, b.orientation, pin],
          c,
        );
      await query(
        "INSERT INTO device_credentials(organization_id,screen_id,token_hash) VALUES($1,$2,$3)",
        [org, s.id, p.device_token_hash],
        c,
      );
      await query(
        "UPDATE pairing_codes SET claimed_at=now(),screen_id=$1 WHERE id=$2",
        [s.id, p.id],
        c,
      );
      await audit(a, "screen.pair", s.id, {}, c);
      return { id: s.id };
    });
  }
  if (resource === "screens" && id) {
    uuid.parse(id);
    const [s] = await query(
      "SELECT * FROM screens WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
      [id, org],
    );
    if (!s) throw new HttpError(404, "Screen not found");
    if (read && operation === "manifest") return manifest(s, true, "staff");
    if (read && operation === "history")
      return {
        publications: await query(
          "SELECT a.*,p.actor_id,u.name actor_name,COALESCE(d.name,pl.name,l.name,'Content') content_name FROM assignments a JOIN publication_events p ON p.id=a.publication_id JOIN users u ON u.id=p.actor_id LEFT JOIN design_versions v ON v.id=a.design_version_id LEFT JOIN designs d ON d.id=v.design_id LEFT JOIN playlist_versions pv ON pv.id=a.playlist_version_id LEFT JOIN playlists pl ON pl.id=pv.playlist_id LEFT JOIN live_boards l ON l.id=a.live_board_id WHERE a.screen_id=$1 ORDER BY a.created_at DESC LIMIT 50",
          [id],
        ),
        acknowledgements: await query(
          "SELECT * FROM render_acknowledgements WHERE screen_id=$1 ORDER BY created_at DESC LIMIT 50",
          [id],
        ),
      };
    if (request.method === "PATCH") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(100),
          location: z.string().max(100),
          orientation: orientationSchema,
        })
        .parse(body);
      await query(
        "UPDATE screens SET name=$1,location=$2,orientation=$3,updated_at=now() WHERE id=$4",
        [b.name, b.location, b.orientation, id],
      );
      await audit(a, "screen.update", id, b);
      return { ok: true };
    }
    if (request.method === "POST" && operation === "refresh") {
      await query(
        "INSERT INTO device_commands(screen_id,kind) SELECT $1,'refresh' WHERE NOT EXISTS(SELECT 1 FROM device_commands WHERE screen_id=$1 AND acknowledged_at IS NULL)",
        [id],
      );
      await audit(a, "screen.refresh", id);
      return { ok: true };
    }
    if (request.method === "POST" && operation === "clear") {
      await query(
        "UPDATE assignments SET cancelled_at=now() WHERE screen_id=$1 AND kind IN ('normal','priority') AND cancelled_at IS NULL",
        [id],
      );
      await audit(a, "screen.clear", id);
      return { ok: true };
    }
    if (request.method === "POST" && operation === "revoke") {
      await transaction(async (c) => {
        await query("UPDATE screens SET revoked_at=now() WHERE id=$1", [id], c);
        await query(
          "UPDATE device_credentials SET revoked_at=now() WHERE screen_id=$1",
          [id],
          c,
        );
        await audit(a, "screen.revoke", id, {}, c);
      });
      return { ok: true };
    }
  }
  if (resource === "designs") {
    if (request.method === "POST" && !id) {
      const b = z
        .object({
          name: z.string().trim().min(1).max(120),
          document: documentSchema,
        })
        .parse(body);
      const [d] = await query(
        "INSERT INTO designs(organization_id,name,document,created_by) VALUES($1,$2,$3,$4) RETURNING *",
        [org, b.name, JSON.stringify(b.document), a.user_id],
      );
      await audit(a, "design.create", d.id);
      return d;
    }
    if (id) {
      uuid.parse(id);
      if (request.method === "PATCH") {
        const b = z
          .object({
            name: z.string().trim().min(1).max(120),
            document: documentSchema,
            revision: z.number().int(),
          })
          .parse(body);
        const [d] = await query(
          "UPDATE designs SET name=$1,document=$2,revision=revision+1,updated_at=now() WHERE id=$3 AND organization_id=$4 AND revision=$5 AND deleted_at IS NULL RETURNING *",
          [b.name, JSON.stringify(b.document), id, org, b.revision],
        );
        if (!d)
          throw new HttpError(
            409,
            "This design changed in another session. Reload before saving.",
          );
        return d;
      }
      if (operation === "publish" && request.method === "POST")
        return transaction(async (c) => {
          const [d] = await query(
            "SELECT * FROM designs WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [id, org],
            c,
          );
          if (!d) throw new HttpError(404, "Design not found");
          const doc = documentSchema.parse(d.document);
          const mediaIds = [
            ...new Set(
              doc.elements.flatMap((e) => (e.assetId ? [e.assetId] : [])),
            ),
          ];
          if (mediaIds.length) {
            const found = await query(
              "SELECT id FROM media_assets WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND deleted_at IS NULL FOR SHARE",
              [mediaIds, org],
              c,
            );
            if (found.length !== mediaIds.length)
              throw new HttpError(
                400,
                "A design image is missing or unavailable.",
              );
          }
          const [v] = await query(
            "INSERT INTO design_versions(organization_id,design_id,version,document,created_by) SELECT $1,$2,COALESCE(MAX(version),0)+1,$3,$4 FROM design_versions WHERE design_id=$2 RETURNING *",
            [org, id, JSON.stringify(doc), a.user_id],
            c,
          );
          for (const mediaId of mediaIds)
            await query(
              "INSERT INTO media_references(organization_id,asset_id,design_version_id) VALUES($1,$2,$3)",
              [org, mediaId, v.id],
              c,
            );
          await audit(a, "design.publish", id, { version: v.version }, c);
          return v;
        });
      if (request.method === "DELETE")
        return transaction(async (c) => {
          const [d] = await query(
            "SELECT id, name FROM designs WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [id, org],
            c,
          );
          if (!d) throw new HttpError(404, "Design not found");
          const active = await query(
            "SELECT a.id FROM assignments a JOIN design_versions dv ON dv.id=a.design_version_id WHERE dv.design_id=$1 AND a.cancelled_at IS NULL AND a.organization_id=$2 LIMIT 1",
            [id, org],
            c,
          );
          if (active.length) {
            throw new HttpError(
              409,
              "This design is currently live on an active screen. Clear or replace it from screens before deleting.",
            );
          }
          await query("UPDATE designs SET deleted_at=now() WHERE id=$1", [id], c);
          await audit(a, "design.archive", id, {}, c);
          return { ok: true };
        });
    }
  }
  if (resource === "groups" && request.method === "POST") {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        screens: z.array(uuid).max(100),
      })
      .parse(body);
    return transaction(async (c) => {
      const found = await query(
        "SELECT id FROM screens WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
        [org, b.screens],
        c,
      );
      if (found.length !== new Set(b.screens).size)
        throw new HttpError(400, "Invalid group screens");
      let group;
      if (id) {
        uuid.parse(id);
        [group] = await query(
          "UPDATE screen_groups SET name=$1 WHERE id=$2 AND organization_id=$3 RETURNING *",
          [b.name, id, org],
          c,
        );
        if (!group) throw new HttpError(404, "Group not found");
        await query(
          "DELETE FROM screen_group_members WHERE group_id=$1",
          [id],
          c,
        );
      } else
        [group] = await query(
          "INSERT INTO screen_groups(organization_id,name) VALUES($1,$2) RETURNING *",
          [org, b.name],
          c,
        );
      for (const screen of new Set(b.screens))
        await query(
          "INSERT INTO screen_group_members(organization_id,group_id,screen_id) VALUES($1,$2,$3)",
          [org, group.id, screen],
          c,
        );
      await audit(a, "group.save", group.id, {}, c);
      return group;
    });
  }
  if (resource === "playlists" && request.method === "POST") {
    const b = z
      .object({
        name: z.string().trim().min(1).max(120),
        orientation: z
          .enum([
            "landscape",
            "landscape-180",
            "portrait",
            "portrait-cw",
            "portrait-ccw",
            "auto",
          ])
          .default("landscape")
          .optional(),
        items: z
          .array(
            z
              .object({
                versionId: uuid.optional(),
                mediaId: uuid.optional(),
                duration: z.number().int().min(2).max(3600),
              })
              .refine((v) => !!v.versionId !== !!v.mediaId),
          )
          .min(1)
          .max(100),
      })
      .parse(body);
    return transaction(async (c) => {
      let p;
      if (id) {
        uuid.parse(id);
        [p] = await query(
          "UPDATE playlists SET name=$1,revision=revision+1 WHERE id=$2 AND organization_id=$3 RETURNING *",
          [b.name, id, org],
          c,
        );
        if (!p) throw new HttpError(404, "Playlist not found");
        await query("DELETE FROM playlist_items WHERE playlist_id=$1", [id], c);
      } else
        [p] = await query(
          "INSERT INTO playlists(organization_id,name) VALUES($1,$2) RETURNING *",
          [org, b.name],
          c,
        );
      const slides: Slide[] = [];
      for (const [i, item] of b.items.entries()) {
        let slide: Slide;
        if (item.versionId) {
          const [v] = await query(
            "SELECT * FROM design_versions WHERE id=$1 AND organization_id=$2",
            [item.versionId, org],
            c,
          );
          if (!v) throw new HttpError(400, "Published design unavailable");
          slide = {
            id: crypto.randomUUID(),
            document: v.document,
            duration: item.duration,
            version: v.version,
          };
        } else {
          const [m] = await query(
            "SELECT * FROM media_assets WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
            [item.mediaId, org],
            c,
          );
          if (!m) throw new HttpError(400, "Image unavailable");

          let slideWidth: 1080 | 1920 = 1920;
          let slideHeight: 1080 | 1920 = 1080;
          let elemX = 0;
          let elemY = 0;
          let elemW = 1920;
          let elemH = 1080;
          let elemRot = 0;

          if (b.orientation === "landscape-180") {
            slideWidth = 1920;
            slideHeight = 1080;
            elemX = 1920;
            elemY = 1080;
            elemW = 1920;
            elemH = 1080;
            elemRot = 180;
          } else if (b.orientation === "portrait-cw") {
            slideWidth = 1080;
            slideHeight = 1920;
            if (!m.width || !m.height || m.width >= m.height) {
              elemX = 1080;
              elemY = 0;
              elemW = 1920;
              elemH = 1080;
              elemRot = 90;
            } else {
              elemX = 0;
              elemY = 0;
              elemW = 1080;
              elemH = 1920;
              elemRot = 0;
            }
          } else if (b.orientation === "portrait-ccw") {
            slideWidth = 1080;
            slideHeight = 1920;
            if (!m.width || !m.height || m.width >= m.height) {
              elemX = 0;
              elemY = 1920;
              elemW = 1920;
              elemH = 1080;
              elemRot = 270;
            } else {
              elemX = 1080;
              elemY = 1920;
              elemW = 1080;
              elemH = 1920;
              elemRot = 180;
            }
          } else if (b.orientation === "portrait") {
            slideWidth = 1080;
            slideHeight = 1920;
            elemX = 0;
            elemY = 0;
            elemW = 1080;
            elemH = 1920;
            elemRot = 0;
          } else if (b.orientation === "landscape") {
            slideWidth = 1920;
            slideHeight = 1080;
            elemX = 0;
            elemY = 0;
            elemW = 1920;
            elemH = 1080;
            elemRot = 0;
          } else {
            // Auto detection based on image aspect ratio
            const isPortrait = m.width && m.height && m.height > m.width;
            slideWidth = isPortrait ? 1080 : 1920;
            slideHeight = isPortrait ? 1920 : 1080;
            elemX = 0;
            elemY = 0;
            elemW = slideWidth;
            elemH = slideHeight;
            elemRot = 0;
          }

          const isVideo = m.mime_type?.startsWith("video/");
          slide = {
            id: crypto.randomUUID(),
            document: {
              schemaVersion: 1,
              width: slideWidth,
              height: slideHeight,
              background: "#070d1e",
              elements: [
                makeElement(isVideo ? "video" : "image", {
                  x: elemX,
                  y: elemY,
                  width: elemW,
                  height: elemH,
                  rotation: elemRot,
                  assetId: m.id,
                  muted: true,
                  loop: true,
                  autoplay: true,
                  fit: "cover",
                }),
              ],
            },
            duration: item.duration,
            version: 1,
          };
        }
        slides.push(slide);
        await query(
          "INSERT INTO playlist_items(organization_id,playlist_id,design_version_id,media_id,position,duration) VALUES($1,$2,$3,$4,$5,$6)",
          [
            org,
            p.id,
            item.versionId ?? null,
            item.mediaId ?? null,
            i,
            item.duration,
          ],
          c,
        );
      }
      const [v] = await query(
        "INSERT INTO playlist_versions(organization_id,playlist_id,version,snapshot) VALUES($1,$2,$3,$4) RETURNING *",
        [org, p.id, p.revision, JSON.stringify(slides)],
        c,
      );
      await audit(a, "playlist.publish", p.id, { version: p.revision }, c);
      return { ...p, publishedVersionId: v.id };
    });
  }
  if (resource === "playlists" && id && request.method === "DELETE") {
    uuid.parse(id);
    return transaction(async (c) => {
      const [p] = await query(
        "SELECT id, name FROM playlists WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [id, org],
        c,
      );
      if (!p) throw new HttpError(404, "Slideshow not found");
      const active = await query(
        "SELECT a.id FROM assignments a JOIN playlist_versions pv ON pv.id=a.playlist_version_id WHERE pv.playlist_id=$1 AND a.cancelled_at IS NULL AND a.organization_id=$2 LIMIT 1",
        [id, org],
        c,
      );
      if (active.length) {
        throw new HttpError(
          409,
          "This slideshow is currently active on one or more screens. Clear or replace it from screens before deleting.",
        );
      }
      await query("UPDATE playlists SET deleted_at=now() WHERE id=$1", [id], c);
      await audit(a, "playlist.archive", id, {}, c);
      return { ok: true };
    });
  }
  if (resource === "live" && request.method === "POST" && !id) {
    const b = z
      .object({
        name: z.string().min(1).max(120),
        versionId: uuid,
        data: liveSchema.optional(),
      })
      .parse(body);
    const [v] = await query(
      "SELECT id FROM design_versions WHERE id=$1 AND organization_id=$2",
      [b.versionId, org],
    );
    if (!v) throw new HttpError(404, "Published layout not found");
    const [board] = await query(
      "INSERT INTO live_boards(organization_id,name,design_version_id,data) VALUES($1,$2,$3,$4) RETURNING *",
      [org, b.name, b.versionId, JSON.stringify(b.data ?? initialLive)],
    );
    await audit(a, "live.create", board.id);
    return board;
  }
  if (resource === "live" && id) {
    uuid.parse(id);
    if (read)
      return {
        updates: await query(
          "SELECT * FROM live_board_updates WHERE live_board_id=$1 AND organization_id=$2 ORDER BY revision DESC LIMIT 100",
          [id, org],
        ),
      };
    if (request.method === "PATCH") {
      const b = z
        .object({ data: liveSchema, revision: z.number().int() })
        .parse(body);
      return transaction(async (c) => {
        const [board] = await query(
          "UPDATE live_boards SET data=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND revision=$4 RETURNING *",
          [JSON.stringify(b.data), id, org, b.revision],
          c,
        );
        if (!board)
          throw new HttpError(
            409,
            "Scores changed elsewhere. Reload before saving.",
          );
        await query(
          "INSERT INTO live_board_updates(organization_id,live_board_id,revision,data,actor_id) VALUES($1,$2,$3,$4,$5)",
          [org, id, board.revision, JSON.stringify(b.data), a.user_id],
          c,
        );
        await audit(a, "live.update", id, { revision: board.revision }, c);
        return board;
      });
    }
  }
  if (resource === "publish" && request.method === "POST") {
    const b = z
      .object({
        contentType: z.enum(["design", "playlist", "live", "media"]),
        contentId: uuid,
        screens: z.array(uuid).min(1).max(100),
        kind: z.enum(["priority", "schedule", "normal", "default"]),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().nullable().optional(),
      })
      .parse(body);
    const start = b.startsAt ? new Date(b.startsAt) : new Date(),
      end = b.endsAt ? new Date(b.endsAt) : null;
    if (end && end <= start)
      throw new HttpError(400, "End must be after start.");
    if (b.kind === "schedule" && !b.startsAt)
      throw new HttpError(400, "Scheduled publishing needs a start time.");
    return transaction(async (c) => {
      const ids = [...new Set(b.screens)].sort();
      const targets = await query(
        "SELECT id FROM screens WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE",
        [org, ids],
        c,
      );
      if (targets.length !== ids.length)
        throw new HttpError(400, "One or more screens are unavailable.");
      let content: string;
      let col: string;
      let pubContentType = b.contentType;

      if (b.contentType === "media") {
        const [m] = await query(
          "SELECT * FROM media_assets WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL",
          [b.contentId, org],
          c,
        );
        if (!m) throw new HttpError(404, "Media asset not found in content library.");
        const isVid = m.mime_type?.startsWith("video/");

        // Target screens orientation
        const [sampleScreen] = await query(
          "SELECT orientation FROM screens WHERE id=$1",
          [ids[0]],
          c,
        );
        const isPortrait =
          sampleScreen?.orientation === "portrait-cw" ||
          sampleScreen?.orientation === "portrait-ccw" ||
          (m.width && m.height && m.height > m.width);

        const canvasWidth = isPortrait ? 1080 : 1920;
        const canvasHeight = isPortrait ? 1920 : 1080;

        // Check if an existing design version exists for this media asset
        let [existingDesign] = await query(
          "SELECT d.id, v.id as version_id FROM designs d JOIN design_versions v ON v.design_id=d.id WHERE d.organization_id=$1 AND d.document::text LIKE $2 AND d.deleted_at IS NULL ORDER BY v.version DESC LIMIT 1",
          [org, `%"assetId":"${m.id}"%`],
          c,
        );

        let versionId = existingDesign?.version_id;

        if (!versionId) {
          const doc = {
            schemaVersion: 1,
            width: canvasWidth,
            height: canvasHeight,
            background: "#070d1e",
            elements: [
              makeElement(isVid ? "video" : "image", {
                x: 0,
                y: 0,
                width: canvasWidth,
                height: canvasHeight,
                assetId: m.id,
                muted: true,
                loop: true,
                autoplay: true,
                fit: "cover",
              }),
            ],
          };

          const [d] = await query(
            "INSERT INTO designs(organization_id, name, document, created_by) VALUES($1,$2,$3,$4) RETURNING *",
            [org, `${isVid ? "🎬 Video: " : "🖼️ Image: "}${m.name}`, JSON.stringify(doc), a.user_id],
            c,
          );

          const [v] = await query(
            "INSERT INTO design_versions(organization_id, design_id, version, document, created_by) VALUES($1,$2,1,$3,$4) RETURNING *",
            [org, d.id, JSON.stringify(doc), a.user_id],
            c,
          );

          await query(
            "INSERT INTO media_references(organization_id, asset_id, design_version_id) VALUES($1,$2,$3)",
            [org, m.id, v.id],
            c,
          );

          versionId = v.id;
        }

        content = versionId;
        col = "design_version_id";
        pubContentType = "design";
      } else {
        col =
          b.contentType === "design"
            ? "design_version_id"
            : b.contentType === "playlist"
              ? "playlist_version_id"
              : "live_board_id";
        const table =
          b.contentType === "design"
            ? "design_versions"
            : b.contentType === "playlist"
              ? "playlist_versions"
              : "live_boards";
        const [found] = await query(
          `SELECT id FROM ${table} WHERE ${b.contentType === "playlist" ? "playlist_id" : "id"}=$1 AND organization_id=$2 ${b.contentType === "playlist" ? "ORDER BY version DESC LIMIT 1" : ""}`,
          [b.contentId, org],
          c,
        );
        if (!found) throw new HttpError(400, "Published content not found.");
        content = found.id;
      }

      if (b.kind === "schedule") {
        const conflicts = await query(
          "SELECT id FROM assignments WHERE screen_id=ANY($1::uuid[]) AND kind='schedule' AND cancelled_at IS NULL AND starts_at<COALESCE($3::timestamptz,'infinity') AND COALESCE(ends_at,'infinity')>$2",
          [ids, start, end],
          c,
        );
        if (conflicts.length)
          throw new HttpError(
            409,
            "Schedule overlaps existing content on a selected screen. Cancel or edit the existing schedule first.",
          );
      }
      const [event] = await query(
        "INSERT INTO publication_events(organization_id,actor_id,kind,content_type,content_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [org, a.user_id, b.kind, pubContentType, content],
        c,
      );
      if (b.kind === "schedule")
        await query(
          "INSERT INTO schedules(organization_id,publication_id,starts_at,ends_at) VALUES($1,$2,$3,$4)",
          [org, event.id, start, end],
          c,
        );
      for (const screen of ids) {
        if (["normal", "default"].includes(b.kind))
          await query(
            "UPDATE assignments SET cancelled_at=now() WHERE screen_id=$1 AND kind=$2 AND cancelled_at IS NULL",
            [screen, b.kind],
            c,
          );
        await query(
          `INSERT INTO assignments(organization_id,screen_id,publication_id,kind,${col},starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [org, screen, event.id, b.kind, content, start, end],
          c,
        );
        await query(
          "UPDATE screens SET updated_at=now() WHERE id=$1",
          [screen],
          c,
        );
      }
      await audit(
        a,
        "content.assign",
        event.id,
        {
          screens: ids,
          kind: b.kind,
          contentType: b.contentType,
          contentId: content,
        },
        c,
      );
      return { id: event.id, targets: ids.length };
    });
  }
  if (resource === "assignments" && id && request.method === "DELETE") {
    uuid.parse(id);
    const rows = await query(
      "UPDATE assignments SET cancelled_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id",
      [id, org],
    );
    if (!rows.length) throw new HttpError(404, "Assignment not found");
    await audit(a, "assignment.cancel", id);
    return { ok: true };
  }
  if (resource === "media") {
    if (id === "ticket" && request.method === "POST") {
      const b = z
        .object({
          size: z
            .number()
            .int()
            .min(1)
            .max(150 * 1024 * 1024),
          mime: z.string().max(100).default("image/jpeg"),
        })
        .parse(await request.json());
      return uploadTicket(a, b.size, b.mime);
    }
    if (
      id === "upload" &&
      request.method === "PUT" &&
      (process.env.NODE_ENV !== "production" || !hasS3())
    ) {
      const key = new URL(request.url).searchParams.get("key") ?? "";
      if (
        !key.startsWith(`quarantine/${org}/`) ||
        !/^quarantine\/[a-f0-9-]+\/[a-f0-9-]+$/.test(key)
      )
        throw new HttpError(400, "Invalid ticket");
      if (Number(request.headers.get("content-length") ?? 0) > 150 * 1024 * 1024)
        throw new HttpError(413, "Media exceeds 150 MB");
      const bytes = Buffer.from(await request.arrayBuffer());
      if (bytes.length > 150 * 1024 * 1024)
        throw new HttpError(413, "Media exceeds 150 MB");
      await putObject(key, bytes, request.headers.get("content-type") || "application/octet-stream");
      return { ok: true };
    }
    if (id === "finish" && request.method === "POST") {
      const b = z
        .object({
          key: z.string().max(200),
          name: z.string().min(1).max(200),
          description: z.string().max(1000).default(""),
          mime: z.string().max(100).optional(),
        })
        .parse(await request.json());
      const asset = await finishUpload(a, b.key, b.name, b.description, b.mime);
      await audit(a, "media.upload", asset.id);
      return asset;
    }
    if (id && operation === "file" && read) {
      uuid.parse(id);
      const [m] = await query(
        "SELECT * FROM media_assets WHERE id=$1 AND organization_id=$2",
        [id, org],
      );
      if (!m) throw new HttpError(404, "Media unavailable");
      const isVideo = m.mime_type?.startsWith("video/");
      const isThumb = new URL(request.url).searchParams.has("thumb");
      return new Response(
        new Uint8Array(
          await getObject(
            isThumb && !isVideo
              ? m.thumbnail_key
              : m.storage_key,
          ),
        ),
        {
          headers: {
            "Content-Type":
              isThumb && !isVideo
                ? "image/webp"
                : m.mime_type || "image/webp",
            "Cache-Control": "private, max-age=300",
            "Accept-Ranges": "bytes",
          },
        },
      );
    }
    if (id && request.method === "DELETE") {
      uuid.parse(id);
      await transaction(async (c) => {
        const [m] = await query(
          "SELECT id FROM media_assets WHERE id=$1 AND organization_id=$2 FOR UPDATE",
          [id, org],
          c,
        );
        if (!m) throw new HttpError(404, "Image not found");
        const refs = await query(
          "SELECT 1 FROM media_references WHERE asset_id=$1 UNION ALL SELECT 1 FROM playlist_items WHERE media_id=$1 UNION ALL SELECT 1 FROM designs WHERE organization_id=$2 AND deleted_at IS NULL AND document::text LIKE $3 UNION ALL SELECT 1 FROM playlist_versions WHERE organization_id=$2 AND snapshot::text LIKE $3 LIMIT 1",
          [id, org, "%" + id + "%"],
          c,
        );
        if (refs.length)
          throw new HttpError(
            409,
            "This image is used by a draft or published content.",
          );
        await query(
          "UPDATE media_assets SET deleted_at=now() WHERE id=$1",
          [id],
          c,
        );
        await audit(a, "media.archive", id, {}, c);
      });
      return { ok: true };
    }
  }
  if (resource === "members" && id && request.method === "DELETE") {
    uuid.parse(id);
    if (id === a.user_id)
      throw new HttpError(400, "You cannot disable your own account.");
    await transaction(async (c) => {
      const [member] = await query(
        "SELECT user_id FROM organization_members WHERE organization_id=$1 AND user_id=$2",
        [org, id],
        c,
      );
      if (!member) throw new HttpError(404, "Member not found");
      await query(
        "DELETE FROM staff_sessions WHERE user_id=$1 AND organization_id=$2",
        [id, org],
        c,
      );
      await query(
        "DELETE FROM organization_members WHERE user_id=$1 AND organization_id=$2",
        [id, org],
        c,
      );
      await audit(a, "staff.remove", id, {}, c);
    });
    return { ok: true };
  }
  throw new HttpError(404, "Not found");
}
