"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Stage,
  Layer,
  Rect,
  Text,
  Image as KonvaImage,
  Transformer,
  Group,
} from "react-konva";
import Konva from "konva";
import QRCode from "qrcode";
import {
  type DesignDocument,
  type Element,
  type LiveData,
  type Manifest,
  canvasTransform,
  playlistPosition,
  fallbackDocument,
} from "./content";
export const brandUrl = (name: string) =>
  typeof window !== "undefined" &&
  window.location.hostname === "appassets.androidplatform.net"
    ? new URL(`brand/${name}`, window.location.href).toString()
    : `/brand/${name}`;
function imageUrl(e: Element, assets: Record<string, string>) {
  return e.assetId
    ? assets[e.assetId]
    : e.brandAsset
      ? brandUrl(e.brandAsset === "crest" ? "crest.png" : e.brandAsset + ".jpg")
      : undefined;
}
export function CanvasRenderer({
  document: doc,
  width,
  assets = {},
  live,
  selected,
  onSelect,
  onChange,
  onReady,
  onError,
  guides = false,
}: {
  document: DesignDocument;
  width: number;
  assets?: Record<string, string>;
  live?: LiveData;
  selected?: string;
  onSelect?: (id: string) => void;
  onChange?: (e: Element) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  guides?: boolean;
}) {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({}),
    [ready, setReady] = useState(false),
    [clock, setClock] = useState(new Date());
  const layer = useRef<Konva.Layer>(null),
    transformer = useRef<Konva.Transformer>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const sourceKey = JSON.stringify(
    doc.elements
      .filter((e) => e.type === "image" || e.type === "qr")
      .map((e) => ({
        id: e.id,
        url: imageUrl(e, assets),
        qr: e.type === "qr" ? e.text : null,
      })),
  );
  useEffect(() => {
    let active = true;
    setReady(false);
    const parsed = JSON.parse(sourceKey) as {
      id: string;
      url?: string;
      qr: string | null;
    }[];
    Promise.all([
      Promise.all([
        window.document.fonts.load('400 48px "Cormorant Garamond"'),
        window.document.fonts.load('400 48px "Plus Jakarta Sans"'),
        window.document.fonts.load('700 48px "Plus Jakarta Sans"'),
      ]),
      ...parsed.map(async (e) => {
        const url =
          e.qr !== null
            ? await QRCode.toDataURL(e.qr || "https://example.com", {
                width: 768,
                margin: 1,
              })
            : e.url;
        if (!url) throw new Error("Image is missing.");
        const image = new window.Image();
        image.crossOrigin = "anonymous";
        image.src = url;
        await image.decode();
        return [e.id, image] as const;
      }),
    ])
      .then((results) => {
        if (active) {
          setImages(
            Object.fromEntries(
              results.slice(1) as [string, HTMLImageElement][],
            ),
          );
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          callbacks.current.onError?.("An image could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [sourceKey]);
  useEffect(() => {
    if (!doc.elements.some((e) => e.type === "clock")) return;
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, [doc.elements]);
  const reportsReady = Boolean(onReady);
  useEffect(() => {
    if (ready) {
      let frame = 0;
      frame = requestAnimationFrame(() => {
        layer.current?.draw();
        frame = requestAnimationFrame(() => callbacks.current.onReady?.());
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [ready, doc, live, reportsReady]);
  useEffect(() => {
    const node = selected ? layer.current?.findOne("#" + selected) : undefined;
    transformer.current?.nodes(node ? [node] : []);
  }, [selected, doc]);
  const scale = width / doc.width;
  const editable = !!onChange;
  return (
    <div
      style={{
        position: "relative",
        width,
        height: doc.height * scale,
        overflow: "hidden",
      }}
    >
      {doc.elements
        .filter((e) => e.type === "video")
        .map((e) => {
          const url = imageUrl(e, assets);
          if (!url) return null;
          return (
            <video
              key={e.id}
              src={url}
              autoPlay={e.autoplay ?? true}
              loop={e.loop ?? true}
              muted={e.muted ?? true}
              playsInline
              style={{
                position: "absolute",
                left: `${e.x * scale}px`,
                top: `${e.y * scale}px`,
                width: `${e.width * scale}px`,
                height: `${e.height * scale}px`,
                transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
                transformOrigin: "top left",
                objectFit: (e.fit as any) || "contain",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          );
        })}
      <Stage
        width={width}
        height={doc.height * scale}
        scaleX={scale}
        scaleY={scale}
        pixelRatio={
          typeof window !== "undefined"
            ? Math.max(window.devicePixelRatio || 1, width >= 960 ? 2 : 1)
            : 1
        }
        style={{ position: "relative", zIndex: 1 }}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) onSelect?.("");
        }}
      >
        <Layer ref={layer}>
          <Rect
            width={doc.width}
            height={doc.height}
            fill={doc.background}
            fillLinearGradientStartPoint={
              doc.gradient ? { x: 0, y: 0 } : undefined
            }
            fillLinearGradientEndPoint={
              doc.gradient ? { x: doc.width, y: doc.height } : undefined
            }
            fillLinearGradientColorStops={
              doc.gradient ? [0, doc.background, 1, doc.gradient] : undefined
            }
          />
          {doc.elements.map((e) => {
            const props = {
              id: e.id,
              x: e.x,
              y: e.y,
              width: e.width,
              height: e.height,
              rotation: e.rotation,
              draggable: editable,
              onClick: () => onSelect?.(e.id),
              onTap: () => onSelect?.(e.id),
              onDragEnd: (ev: Konva.KonvaEventObject<DragEvent>) =>
                onChange?.({
                  ...e,
                  x: Math.round(ev.target.x()),
                  y: Math.round(ev.target.y()),
                }),
              onTransformEnd: (ev: Konva.KonvaEventObject<Event>) => {
                const n = ev.target;
                const next = {
                  ...e,
                  x: Math.round(n.x()),
                  y: Math.round(n.y()),
                  width: Math.max(10, Math.round(e.width * n.scaleX())),
                  height: Math.max(10, Math.round(e.height * n.scaleY())),
                  rotation: n.rotation(),
                };
                n.scaleX(1);
                n.scaleY(1);
                onChange?.(next);
              },
            };
            if (e.type === "video") {
              return (
                <Group key={e.id} {...props}>
                  <Rect
                    width={e.width}
                    height={e.height}
                    fill={editable ? "rgba(18, 32, 70, 0.2)" : "transparent"}
                    stroke={editable ? "#c5a059" : undefined}
                    strokeWidth={editable ? 2 : 0}
                    dash={editable ? [8, 8] : undefined}
                  />
                  {editable && (
                    <Text
                      text="🎬 VIDEO"
                      x={10}
                      y={10}
                      fill="#c5a059"
                      fontSize={24}
                      fontFamily="Plus Jakarta Sans"
                      fontStyle="bold"
                    />
                  )}
                </Group>
              );
            }
            if (e.type === "rect")
              return <Rect key={e.id} {...props} fill={e.fill} />;
            if (e.type === "image" || e.type === "qr") {
              const img = images[e.id];
              if (!img) return <Rect key={e.id} {...props} fill="#e8dcce" />;
              const fit = e.fit || "contain";
              let drawW = e.width;
              let drawH = e.height;
              let drawX = 0;
              let drawY = 0;

              if (fit === "cover") {
                const factor = Math.max(e.width / img.width, e.height / img.height);
                drawW = img.width * factor;
                drawH = img.height * factor;
                drawX = (e.width - drawW) / 2;
                drawY = (e.height - drawH) / 2;
              } else if (fit === "fill") {
                drawW = e.width;
                drawH = e.height;
                drawX = 0;
                drawY = 0;
              } else {
                // contain
                const factor = Math.min(e.width / img.width, e.height / img.height);
                drawW = img.width * factor;
                drawH = img.height * factor;
                drawX = (e.width - drawW) / 2;
                drawY = (e.height - drawH) / 2;
              }

              return (
                <Group
                  key={e.id}
                  {...props}
                  clipX={0}
                  clipY={0}
                  clipWidth={e.width}
                  clipHeight={e.height}
                >
                  <Rect width={e.width} height={e.height} fill="transparent" />
                  <KonvaImage
                    listening={false}
                    image={img}
                    width={drawW}
                    height={drawH}
                    x={drawX}
                    y={drawY}
                  />
                </Group>
              );
            }
            let text =
              e.type === "clock"
                ? clock.toLocaleString("en-CA", {
                    timeZone: "America/Toronto",
                    month: "long",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : e.binding && live
                  ? String(live[e.binding as keyof LiveData] ?? e.text)
                  : e.text;
            if (
              live &&
              ((e.binding === "player1" && live.serving === "1") ||
                (e.binding === "player2" && live.serving === "2"))
            ) {
              const serverSuffix =
                live.sport === "pickleball" && live.serverNumber
                  ? ` [S${live.serverNumber}]`
                  : "";
              text = "● " + text + serverSuffix;
            }
            return (
              <Text
                key={e.id}
                {...props}
                text={text}
                fill={e.fill}
                fontFamily={e.fontFamily}
                fontSize={e.fontSize}
                fontStyle={e.bold ? "bold" : "normal"}
                align={e.align}
                lineHeight={1.15}
                wrap="word"
              />
            );
          })}
          {guides && (
            <Rect
              x={54}
              y={54}
              width={doc.width - 108}
              height={doc.height - 108}
              stroke="#b39164"
              strokeWidth={2}
              dash={[10, 10]}
              listening={false}
            />
          )}
          {editable && (
            <Transformer
              ref={transformer}
              rotateEnabled
              boundBoxFunc={(old, b) => (b.width < 10 || b.height < 10 ? old : b)}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
// A TV that hasn't reached the server for this long shows when its content was last updated.
export const STALE_AFTER_MS = 2 * 60 * 1000;

export function lastUpdatedLabel(lastSyncAt: number, now: Date = new Date()) {
  const at = new Date(lastSyncAt);
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return at.toDateString() === now.toDateString()
    ? time
    : at.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        ", " +
        time;
}

function OfflineBadge({
  lastSyncAt,
  height,
}: {
  lastSyncAt: number;
  height: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  if (now - lastSyncAt < STALE_AFTER_MS) return null;
  const size = Math.max(12, Math.round(height * 0.018));
  return (
    <div
      data-testid="offline-badge"
      style={{
        position: "absolute",
        right: "2.5%",
        bottom: "2.5%",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: size * 0.5,
        padding: `${size * 0.45}px ${size * 0.9}px`,
        borderRadius: 999,
        background: "rgba(7, 13, 30, 0.72)",
        color: "rgba(255, 255, 255, 0.85)",
        fontFamily: "system-ui, sans-serif",
        fontSize: size,
        lineHeight: 1,
      }}
    >
      <span
        style={{
          width: size * 0.55,
          height: size * 0.55,
          borderRadius: "50%",
          background: "#f2b33d",
        }}
      />
      {lastSyncAt > 0
        ? "Offline · last updated " + lastUpdatedLabel(lastSyncAt, new Date(now))
        : "Offline · waiting for first update"}
    </div>
  );
}

export function DisplayPlayer({
  manifest: m,
  assets,
  lastSyncAt,
  onRender,
  onError,
}: {
  manifest: Manifest;
  assets?: Record<string, string>;
  /** Epoch ms of the device's last successful sync; 0 if it has never synced. Omit to hide the badge. */
  lastSyncAt?: number;
  onRender?: (slideId: string) => void;
  onError?: (message: string) => void;
}) {
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 }),
    [index, setIndex] = useState(0),
    [previous, setPrevious] = useState<number | null>(null),
    [failed, setFailed] = useState<Set<string>>(new Set());
  const lastIndex = useRef(0);
  const callback = useRef(onError);
  callback.current = onError;
  useEffect(() => {
    const size = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, []);
  useEffect(() => {
    setFailed(new Set());
  }, [m.revision]);
  const slides = m.slides.filter((s) => !failed.has(s.id));
  const signature = slides.map((s) => s.id + ":" + s.duration).join(",");
  useEffect(() => {
    if (!slides.length) return;
    const tick = () => {
      const pos = playlistPosition(
        slides.map((s) => s.duration),
        Date.now() - m.epoch,
      );
      if (lastIndex.current !== pos.index) {
        setPrevious(lastIndex.current);
        lastIndex.current = pos.index;
      }
      setIndex(pos.index);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [signature, m.epoch]);
  useEffect(() => {
    if (previous === null) return;
    const t = setTimeout(() => setPrevious(null), 450);
    return () => clearTimeout(t);
  }, [previous, index]);
  const transform = canvasTransform(
    m.orientation,
    viewport.width,
    viewport.height,
  );
  const urls =
    assets ??
    Object.fromEntries(Object.entries(m.assets).map(([id, a]) => [id, a.url]));
  const active = slides[index % Math.max(slides.length, 1)];
  const next = slides[(index + 1) % Math.max(slides.length, 1)];
  const draw = (slide: typeof active, isActive: boolean, key: string) => {
    if (!slide) return null;
    const w = Math.min(
      transform.width,
      (transform.height * slide.document.width) / slide.document.height,
    );
    return (
      <div
        key={key}
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          opacity: isActive ? 1 : 0,
          transition: "opacity 400ms ease",
          zIndex: isActive ? 2 : 1,
        }}
      >
        <CanvasRenderer
          document={slide.document}
          width={w}
          assets={urls}
          live={slide.live}
          onReady={isActive ? () => onRender?.(slide.id) : undefined}
          onError={(message) => {
            setFailed((old) => new Set([...old, slide.id]));
            callback.current?.(message);
          }}
        />
      </div>
    );
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#070d1e",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: transform.width,
          height: transform.height,
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
        }}
      >
        {active ? (
          slides
            .filter(
              (s) =>
                s.id === active.id ||
                s.id === next?.id ||
                s.id === slides[previous ?? -1]?.id,
            )
            .map((s) => draw(s, s.id === active.id, s.id))
        ) : (
          <CanvasRenderer
            document={fallbackDocument}
            width={Math.min(transform.width, (transform.height * 1080) / 1920)}
          />
        )}
        {lastSyncAt !== undefined && (
          <OfflineBadge lastSyncAt={lastSyncAt} height={transform.height} />
        )}
      </div>
    </div>
  );
}
