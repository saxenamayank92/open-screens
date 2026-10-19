import { NextResponse } from "next/server";
import { staff, checkOrigin, HttpError } from "@/server/auth";
import { query, transaction } from "@/server/db";
import { storeImage, storeVideo } from "@/server/media";
import { expireScreens } from "@/server/screen-cache";
import { makeElement, generateUUID } from "@/shared/content";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, unlink, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    checkOrigin(request);
    const a = await staff(request);
    const org = a.organization_id;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new HttpError(400, "Please choose an image, PDF, or video file to cast.");

    const rawScreens = formData.get("screens");
    let screenIds: string[] = [];
    if (rawScreens) {
      try {
        screenIds = JSON.parse(rawScreens.toString());
      } catch {
        screenIds = [rawScreens.toString()];
      }
    }

    // Default to all active screens if none selected
    if (!screenIds.length) {
      const active = await query("SELECT id FROM screens WHERE organization_id=$1 AND deleted_at IS NULL", [org]);
      screenIds = active.map((s: any) => s.id);
    }
    if (!screenIds.length) {
      throw new HttpError(400, "No TV screens are currently connected or paired.");
    }

    const duration = Math.max(3, Math.min(300, Number(formData.get("duration")) || 10));
    const customTitle = (formData.get("title")?.toString() || file.name.replace(/\.[^/.]+$/, "")).slice(0, 120);
    const requestedKind = formData.get("kind")?.toString() === "normal" ? "normal" : "priority";

    // Scheduling parameters
    const scheduleMode = formData.get("scheduleMode")?.toString() || "now";
    const rawStartsAt = formData.get("startsAt")?.toString();
    const rawEndsAt = formData.get("endsAt")?.toString();
    const autoExpire = formData.get("autoExpire")?.toString();
    const fit = (formData.get("fit")?.toString() as "cover" | "contain" | "fill") || "cover";

    let startsDate: Date = new Date();
    let endsDate: Date | null = null;
    let kind: "priority" | "normal" | "schedule" = requestedKind;

    if (scheduleMode === "later" && rawStartsAt) {
      startsDate = new Date(rawStartsAt);
      if (isNaN(startsDate.getTime())) {
        throw new HttpError(400, "Invalid scheduled start time.");
      }
      kind = "schedule";
    }

    if (rawEndsAt) {
      endsDate = new Date(rawEndsAt);
      if (isNaN(endsDate.getTime())) {
        throw new HttpError(400, "Invalid end time.");
      }
      if (endsDate <= startsDate) {
        throw new HttpError(400, "End time must be after start time.");
      }
    } else if (autoExpire) {
      const hours = Number(autoExpire);
      if (!isNaN(hours) && hours > 0) {
        endsDate = new Date(startsDate.getTime() + hours * 3600 * 1000);
      } else if (autoExpire === "today") {
        const midnight = new Date(startsDate);
        midnight.setHours(23, 59, 59, 999);
        endsDate = midnight;
      }
    }

    const arrayBuf = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuf);
    if (fileBuffer.length > 150 * 1024 * 1024) {
      throw new HttpError(413, "File exceeds 150 MB limit.");
    }

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf") ||
      fileBuffer.subarray(0, 5).toString() === "%PDF-";

    const isVideo =
      file.type.startsWith("video/") ||
      /\.(mp4|webm|mov)$/i.test(file.name);

    // Detect target canvas dimensions based on chosen screens (default to 1920x1080 landscape)
    const targetScreens = await query(
      "SELECT id, orientation FROM screens WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
      [org, screenIds]
    );
    if (!targetScreens.length) throw new HttpError(404, "Target screens not found.");

    const isTargetPortrait = targetScreens.some(
      (s: any) => s.orientation === "portrait-cw" || s.orientation === "portrait-ccw"
    );
    const canvasWidth = isTargetPortrait ? 1080 : 1920;
    const canvasHeight = isTargetPortrait ? 1920 : 1080;

    let mediaAssets: any[] = [];
    let contentType: "image" | "pdf" | "video" = "image";

    if (isPdf) {
      contentType = "pdf";
      const tempId = generateUUID();
      const tmpPdfPath = path.join(os.tmpdir(), `cast-${tempId}.pdf`);
      const tmpOutputDir = path.join(os.tmpdir(), `cast-out-${tempId}`);

      try {
        await writeFile(tmpPdfPath, fileBuffer);
        await mkdir(tmpOutputDir, { recursive: true });

        const helperBin = path.join(process.cwd(), "bin", "pdf2images");
        await execFileAsync(helperBin, [tmpPdfPath, tmpOutputDir], { timeout: 30000 });

        const outputFiles = (await readdir(tmpOutputDir))
          .filter((f) => f.endsWith(".png"))
          .sort();

        if (!outputFiles.length) {
          throw new HttpError(400, "Could not extract pages from this PDF.");
        }

        for (let i = 0; i < outputFiles.length; i++) {
          const pageFileName = outputFiles[i];
          const pageImgBuf = await readFile(path.join(tmpOutputDir, pageFileName));
          const assetName = `${customTitle} (Page ${i + 1}/${outputFiles.length})`;
          const asset = await storeImage(a, pageImgBuf, assetName, `Page ${i + 1} of PDF cast`);
          mediaAssets.push(asset);
        }
      } finally {
        await unlink(tmpPdfPath).catch(() => {});
        await rm(tmpOutputDir, { recursive: true, force: true }).catch(() => {});
      }
    } else if (isVideo) {
      contentType = "video";
      const mime = file.type || (file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4");
      const asset = await storeVideo(a, fileBuffer, customTitle, mime, "Direct video cast");
      mediaAssets.push(asset);
    } else {
      // Direct Image
      contentType = "image";
      const asset = await storeImage(a, fileBuffer, customTitle, "Direct image cast");
      mediaAssets.push(asset);
    }

    let publicationEventId = "";
    let publishedType: "design" | "playlist" = "design";
    let publishedContentId = "";

    await transaction(async (c) => {
      if (mediaAssets.length === 1) {
        // Single slide (Image or Video) -> Design Version
        publishedType = "design";
        const isVid = contentType === "video";
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
              assetId: mediaAssets[0].id,
              muted: true,
              loop: true,
              autoplay: true,
              fit,
            }),
          ],
        };

        const [design] = await query(
          "INSERT INTO designs(organization_id, name, document, created_by) VALUES($1,$2,$3,$4) RETURNING *",
          [org, `${isVid ? "🎬" : "⚡️"} ${customTitle}`, JSON.stringify(doc), a.user_id],
          c
        );

        const [version] = await query(
          "INSERT INTO design_versions(organization_id, design_id, version, document, created_by) VALUES($1,$2,1,$3,$4) RETURNING *",
          [org, design.id, JSON.stringify(doc), a.user_id],
          c
        );

        await query(
          "INSERT INTO media_references(organization_id, asset_id, design_version_id) VALUES($1,$2,$3)",
          [org, mediaAssets[0].id, version.id],
          c
        );

        publishedContentId = version.id;

        const [event] = await query(
          "INSERT INTO publication_events(organization_id, actor_id, kind, content_type, content_id) VALUES($1,$2,$3,'design',$4) RETURNING *",
          [org, a.user_id, kind, publishedContentId],
          c
        );
        publicationEventId = event.id;

        const isFuture = startsDate.getTime() > Date.now();
        for (const screenId of screenIds) {
          if (!isFuture) {
            await query(
              "UPDATE assignments SET cancelled_at=now() WHERE screen_id=$1 AND kind=$2 AND cancelled_at IS NULL",
              [screenId, kind],
              c
            );
          }
          await query(
            "INSERT INTO assignments(organization_id, screen_id, publication_id, kind, design_version_id, starts_at, ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [org, screenId, event.id, kind, publishedContentId, startsDate.toISOString(), endsDate ? endsDate.toISOString() : null],
            c
          );
          if (!isFuture) {
            await query("UPDATE screens SET updated_at=now() WHERE id=$1", [screenId], c);
          }
        }
      } else {
        // Multi-page PDF -> Playlist Slideshow
        publishedType = "playlist";
        const [playlist] = await query(
          "INSERT INTO playlists(organization_id, name) VALUES($1,$2) RETURNING *",
          [org, `⚡️ ${customTitle} (Slideshow)`],
          c
        );

        const slides = mediaAssets.map((asset) => ({
          id: generateUUID(),
          document: {
            schemaVersion: 1,
            width: canvasWidth,
            height: canvasHeight,
            background: "#070d1e",
            elements: [
              makeElement("image", {
                x: 0,
                y: 0,
                width: canvasWidth,
                height: canvasHeight,
                assetId: asset.id,
                fit,
              }),
            ],
          },
          duration,
          version: 1,
        }));

        for (let i = 0; i < mediaAssets.length; i++) {
          await query(
            "INSERT INTO playlist_items(organization_id, playlist_id, media_id, position, duration) VALUES($1,$2,$3,$4,$5)",
            [org, playlist.id, mediaAssets[i].id, i, duration],
            c
          );
        }

        const [pVersion] = await query(
          "INSERT INTO playlist_versions(organization_id, playlist_id, version, snapshot) VALUES($1,$2,1,$3) RETURNING *",
          [org, playlist.id, JSON.stringify(slides)],
          c
        );

        publishedContentId = pVersion.id;

        const [event] = await query(
          "INSERT INTO publication_events(organization_id, actor_id, kind, content_type, content_id) VALUES($1,$2,$3,'playlist',$4) RETURNING *",
          [org, a.user_id, kind, publishedContentId],
          c
        );
        publicationEventId = event.id;

        const isFuture = startsDate.getTime() > Date.now();
        for (const screenId of screenIds) {
          if (!isFuture) {
            await query(
              "UPDATE assignments SET cancelled_at=now() WHERE screen_id=$1 AND kind=$2 AND cancelled_at IS NULL",
              [screenId, kind],
              c
            );
          }
          await query(
            "INSERT INTO assignments(organization_id, screen_id, publication_id, kind, playlist_version_id, starts_at, ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [org, screenId, event.id, kind, publishedContentId, startsDate.toISOString(), endsDate ? endsDate.toISOString() : null],
            c
          );
          if (!isFuture) {
            await query("UPDATE screens SET updated_at=now() WHERE id=$1", [screenId], c);
          }
        }
      }
    });

    const isFuture = startsDate.getTime() > Date.now();
    await expireScreens();
    return NextResponse.json({
      ok: true,
      type: contentType,
      scheduled: isFuture,
      startsAt: startsDate.toISOString(),
      endsAt: endsDate ? endsDate.toISOString() : null,
      pagesCount: mediaAssets.length,
      screensCount: screenIds.length,
      title: customTitle,
      publicationEventId,
    });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err?.message || "Failed to quick cast to screen.";
    console.error("Quick cast error:", err);
    await expireScreens();
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
