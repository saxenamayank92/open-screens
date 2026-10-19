import { ZodError } from "zod";
import { accountApi } from "@/server/account-api";
import { deviceApi, cachedDevice } from "@/server/device-api";
import { staffApi } from "@/server/staff-api";
import { checkOrigin, HttpError } from "@/server/auth";
import { getObject } from "@/server/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { path } = await context.params;
    if (path[0] !== "device") checkOrigin(request);
    let result;
    if (path[0] === "device" && path[1] === "media" && path[2]) {
      const { sync } = await cachedDevice(request);
      const asset = sync.manifest.assets[path[2]];
      if (!asset) throw new HttpError(403, "Asset not assigned to this device");
      result = new Response(
        new Uint8Array(await getObject(sync.storageKeys[path[2]])),
        {
          headers: {
            "Content-Type": asset.mimeType || "image/webp",
            "Cache-Control": "private, max-age=300",
            "Accept-Ranges": "bytes",
          },
        },
      );
    } else
      result =
        path[0] === "auth"
          ? await accountApi(request, path.slice(1))
          : path[0] === "device"
            ? await deviceApi(request, path.slice(1))
            : await staffApi(request, path);
    const response =
      result instanceof Response ? result : Response.json(result);
    if (!response.headers.has("Cache-Control"))
      response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Request-ID", requestId);
    return response;
  } catch (e) {
    const status =
      e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500;
    const message =
      e instanceof HttpError
        ? e.message
        : e instanceof ZodError
          ? e.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
          : "The request could not be completed. Please retry.";
    console.error(
      JSON.stringify({
        event: "request_failed",
        requestId,
        status,
        code: (e as { code?: string }).code,
        message: status === 500 ? (e as Error).message : message,
      }),
    );
    return Response.json(
      { error: message, requestId },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as PUT,
  handle as DELETE,
};
