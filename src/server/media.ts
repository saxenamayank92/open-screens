import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hash, HttpError, type Actor } from "./auth";
import { query } from "./db";
import { createHash } from "node:crypto";
export function hasS3() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_BUCKET &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
  );
}
function local() {
  return process.env.NODE_ENV !== "production" && process.env.LOCAL_MEDIA_DIR;
}
function s3() {
  if (!hasS3())
    throw new HttpError(503, "Media storage is not configured.");
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}
export async function putObject(
  key: string,
  data: Buffer,
  contentType = "image/webp",
) {
  const dir = local();
  if (dir) {
    await mkdir(path.join(dir, path.dirname(key)), { recursive: true });
    await writeFile(path.join(dir, key), data);
    return;
  }
  if (hasS3()) {
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    return;
  }
  await query(
    "INSERT INTO media_blobs(key, data, content_type) VALUES($1, $2, $3) ON CONFLICT(key) DO UPDATE SET data=$2, content_type=$3",
    [key, data, contentType],
  );
}
export async function getObject(key: string) {
  const dir = local();
  if (dir) return readFile(path.join(dir, key));
  if (hasS3()) {
    const client = s3();
    const meta = await client.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    );
    if ((meta.ContentLength ?? 0) > 150 * 1024 * 1024)
      throw new HttpError(413, "Media exceeds 150 MB");
    const obj = await client.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    );
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > 150 * 1024 * 1024)
        throw new HttpError(413, "Media exceeds 150 MB");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const [row] = await query("SELECT data FROM media_blobs WHERE key=$1", [key]);
  if (!row) throw new HttpError(404, "Image not found");
  return Buffer.from(row.data);
}
export async function assetUrl(id: string, key: string) {
  return local() || !hasS3()
    ? `/api/v1/media/${id}/file`
    : getSignedUrl(
        s3(),
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
        { expiresIn: 300 },
      );
}
export async function validateImage(buffer: Buffer) {
  if (buffer.length > 50 * 1024 * 1024 || !buffer.length)
    throw new HttpError(400, "Images must be between 1 byte and 50 MB.");
  const head = buffer.subarray(0, 512).toString();
  if (/<svg|<\?xml/i.test(head)) {
    const svg = buffer.toString();
    if (
      /<!DOCTYPE|<!ENTITY|<script|<foreignObject|(?:href|src)\s*=\s*["'](?!#)|url\s*\(/i.test(
        svg,
      )
    )
      throw new HttpError(
        400,
        "SVG must not contain scripts, external resources or embedded HTML.",
      );
  }
  try {
    const source = sharp(buffer, {
      limitInputPixels: false,
      animated: false,
      page: 0,
    });
    const meta = await source.metadata();
    if (
      meta.format === "svg" &&
      /<!DOCTYPE|<!ENTITY|<script|<style|<foreignObject|(?:href|src)\s*=\s*["'](?!#)|url\s*\(/i.test(
        buffer.toString(),
      )
    )
      throw new HttpError(400, "Unsafe SVG content detected.");

    const allowed = new Set([
      "jpeg",
      "jpg",
      "png",
      "webp",
      "svg",
      "heif",
      "heic",
      "avif",
      "tiff",
      "gif",
    ]);
    if (!meta.format || !allowed.has(meta.format)) {
      throw new HttpError(
        400,
        `Unsupported image format (${meta.format || "unknown"}). Supported formats: JPEG, PNG, WebP, HEIC/HEIF, AVIF, TIFF, SVG.`,
      );
    }

    const output = await source
      .rotate()
      .resize({
        width: 3840,
        height: 3840,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(output.data)
      .resize({ width: 360, height: 480, fit: "inside" })
      .webp()
      .toBuffer();
    return {
      data: output.data,
      thumbnail,
      width: output.info.width,
      height: output.info.height,
      sha256: createHash("sha256").update(output.data).digest("hex"),
    };
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    const msg = err?.message || "";
    throw new HttpError(
      400,
      msg ? `Image processing error: ${msg}` : "Use a valid JPEG, PNG, WebP, HEIC, AVIF, TIFF or SVG under 50 MB.",
    );
  }
}
export async function storeImage(
  a: Actor,
  buffer: Buffer,
  name: string,
  description = "",
) {
  const image = await validateImage(buffer);
  const id = crypto.randomUUID();
  const key = `${a.organization_id}/${id}.webp`,
    thumb = `${a.organization_id}/${id}-thumb.webp`;
  await Promise.all([
    putObject(key, image.data),
    putObject(thumb, image.thumbnail),
  ]);
  return (
    await query(
      "INSERT INTO media_assets(id,organization_id,name,description,mime_type,width,height,byte_size,sha256,storage_key,thumbnail_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [
        id,
        a.organization_id,
        name.slice(0, 200),
        description.slice(0, 1000),
        "image/webp",
        image.width,
        image.height,
        image.data.length,
        image.sha256,
        key,
        thumb,
      ],
    )
  )[0];
}
export async function storeVideo(
  a: Actor,
  buffer: Buffer,
  name: string,
  mimeType = "video/mp4",
  description = "",
) {
  if (buffer.length > 150 * 1024 * 1024 || !buffer.length) {
    throw new HttpError(400, "Video must be between 1 byte and 150 MB.");
  }
  const id = crypto.randomUUID();
  const ext = mimeType.includes("webm") ? "webm" : "mp4";
  const key = `${a.organization_id}/${id}.${ext}`;
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  await putObject(key, buffer, mimeType);

  return (
    await query(
      "INSERT INTO media_assets(id,organization_id,name,description,mime_type,width,height,byte_size,sha256,storage_key,thumbnail_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [
        id,
        a.organization_id,
        name.slice(0, 200),
        description.slice(0, 1000),
        mimeType,
        1920,
        1080,
        buffer.length,
        sha256,
        key,
        key,
      ],
    )
  )[0];
}
export async function uploadTicket(a: Actor, size: number, mime: string) {
  const key = `quarantine/${a.organization_id}/${crypto.randomUUID()}`;
  if (local() || !hasS3())
    return { key, url: "/api/v1/media/upload?key=" + encodeURIComponent(key) };
  return {
    key,
    url: await getSignedUrl(
      s3(),
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ContentLength: size,
        ContentType: mime,
      }),
      { expiresIn: 300 },
    ),
  };
}
export async function finishUpload(
  a: Actor,
  key: string,
  name: string,
  description: string,
  mime?: string,
) {
  if (
    !key.startsWith(`quarantine/${a.organization_id}/`) ||
    !/^quarantine\/[a-f0-9-]+\/[a-f0-9-]+$/.test(key)
  )
    throw new HttpError(400, "Invalid upload ticket.");
  const buffer = await getObject(key);
  const isVideo =
    mime?.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|ogg)$/i.test(name);
  const result = isVideo
    ? await storeVideo(a, buffer, name, mime || "video/mp4", description)
    : await storeImage(a, buffer, name, description);
  if (hasS3()) {
    await s3().send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    );
  } else if (!local()) {
    await query("DELETE FROM media_blobs WHERE key=$1", [key]);
  }
  return result;
}
