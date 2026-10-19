export async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export const date = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString("en-CA", {
        timeZone: "America/Toronto",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not yet";

export async function prepareImageForUpload(
  file: File,
  maxDimension = 4096,
  maxPixels = 30_000_000,
): Promise<File> {
  // Only process raster images (skip SVG, video, PDF)
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml" ||
    file.name.toLowerCase().endsWith(".svg")
  ) {
    return file;
  }

  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Cannot decode image"));
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    URL.revokeObjectURL(url);

    // If within safe limits (under 30 MP and maxDimension 4096px), no scaling needed
    if (w * h <= maxPixels && Math.max(w, h) <= maxDimension) {
      return file;
    }

    // Target 4K resolution (max 4096px preserving aspect ratio)
    const scale = Math.min(
      maxDimension / Math.max(w, h),
      Math.sqrt(maxPixels / (w * h)),
      1,
    );
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const isPng = file.type === "image/png";
    const mime = isPng ? "image/png" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), mime, 0.92),
    );

    if (!blob) return file;

    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const ext = isPng ? ".png" : ".webp";
    return new File([blob], `${baseName}${ext}`, { type: mime });
  } catch (e) {
    console.warn("Client-side image preparation skipped:", e);
    return file;
  }
}

export async function uploadMedia(
  rawFile: File,
  description = "",
  onProgress?: (pct: number) => void,
) {
  const isVideo =
    rawFile.type.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|ogg)$/i.test(rawFile.name);
  const file = isVideo ? rawFile : await prepareImageForUpload(rawFile);
  const maxSize = isVideo ? 150 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > maxSize)
    throw new Error(isVideo ? "Videos must be under 150 MB." : "Images must be under 50 MB.");
  const mimeType = file.type || (isVideo ? "video/mp4" : "image/jpeg");
  const ticket = await api("media/ticket", "POST", {
    size: file.size,
    mime: mimeType,
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.url);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress && onProgress(Math.round((e.loaded / e.total) * 90));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed"));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
  if (onProgress) onProgress(95);
  const asset = await api("media/finish", "POST", {
    key: ticket.key,
    name: file.name,
    description,
    mime: mimeType,
  });
  if (onProgress) onProgress(100);
  return asset;
}

