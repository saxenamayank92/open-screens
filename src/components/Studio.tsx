"use client";
import { useState, useEffect, useRef } from "react";
import { CanvasRenderer } from "@/shared/Renderer";
import {
  template,
  templateNames,
  makeElement,
  generateUUID,
  type DesignDocument,
  type Element,
} from "@/shared/content";
import { api, uploadMedia } from "./api";

export const CLUB_PALETTE = [
  { name: "Club Navy", hex: "#122046" },
  { name: "Classic Gold", hex: "#c5a059" },
  { name: "Warm Cream", hex: "#fbf9f5" },
  { name: "Deep Midnight", hex: "#070d1e" },
  { name: "Lawn Green", hex: "#1b4332" },
  { name: "Pure White", hex: "#ffffff" },
  { name: "Crimson", hex: "#8b263e" },
  { name: "Slate", hex: "#4a5568" },
];

const TEMPLATE_META: Record<string, { icon: string; category: string }> = {
  "Tournament welcome": { icon: "🏆", category: "Welcome" },
  "General announcement": { icon: "📢", category: "Club Notice" },
  "Sponsor advertisement": { icon: "🤝", category: "Partners" },
  "Fullscreen image": { icon: "🖼️", category: "Full Photo" },
  "Live tennis scoreboard": { icon: "🎾", category: "Tennis" },
  "Live pickleball scoreboard": { icon: "🏓", category: "Pickleball" },
  "Live squash scoreboard": { icon: "🔴", category: "Squash" },
  "Live badminton scoreboard": { icon: "🏸", category: "Badminton" },
};

function SwatchPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}) {
  return (
    <div className="swatch-container">
      {label && <span className="swatch-label">{label}</span>}
      <div className="color-swatches">
        {CLUB_PALETTE.map((c) => (
          <button
            key={c.hex}
            type="button"
            className={
              "swatch-btn" +
              (value?.toLowerCase() === c.hex.toLowerCase() ? " active" : "")
            }
            style={{ backgroundColor: c.hex }}
            title={`${c.name} (${c.hex})`}
            onClick={() => onChange(c.hex)}
          />
        ))}
        <label className="swatch-custom" title="Custom color picker">
          <input
            type="color"
            value={value || "#122046"}
            onChange={(e) => onChange(e.target.value)}
          />
          <span>🎨</span>
        </label>
      </div>
    </div>
  );
}

export function Studio({
  state,
  notify,
  reload,
}: {
  state: any;
  notify: (message: string) => void;
  reload: () => Promise<void>;
}) {
  const [id, setId] = useState(""),
    [revision, setRevision] = useState(1),
    [name, setName] = useState("Tournament welcome"),
    [doc, setDoc] = useState<DesignDocument>(() =>
      template("Tournament welcome"),
    ),
    [selected, setSelected] = useState(""),
    [undo, setUndo] = useState<DesignDocument[]>([]),
    [redo, setRedo] = useState<DesignDocument[]>([]),
    [guides, setGuides] = useState(true),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [canvasWidth, setCanvasWidth] = useState(480),
    [showCoords, setShowCoords] = useState(false),
    [uploadingImg, setUploadingImg] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const draft = state.designs.find((d: any) => d.id === params.get("design"));
    if (draft) {
      setId(draft.id);
      setRevision(draft.revision);
      setName(draft.name);
      setDoc(draft.document);
    } else {
      const chosen = params.get("template");
      if (chosen && templateNames.includes(chosen)) {
        setName(chosen);
        setDoc(template(chosen));
      }
    }
  }, []);

  useEffect(() => {
    const resize = () =>
      setCanvasWidth(Math.min(600, Math.max(260, window.innerWidth - 660)));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function change(next: DesignDocument) {
    setUndo((s) => [...s.slice(-49), doc]);
    setRedo([]);
    setDoc(next);
    setDirty(true);
  }

  const element = doc.elements.find((e) => e.id === selected);
  const patch = (values: Partial<Element>) => {
    if (element)
      change({
        ...doc,
        elements: doc.elements.map((e) =>
          e.id === selected ? { ...e, ...values } : e,
        ),
      });
  };

  function deleteElement(elementId = selected) {
    if (!elementId) return;
    change({
      ...doc,
      elements: doc.elements.filter((e) => e.id !== elementId),
    });
    if (selected === elementId) setSelected("");
    notify("Element removed from canvas");
  }

  function duplicateElement(elementId = selected) {
    const el = doc.elements.find((e) => e.id === elementId);
    if (!el) return;
    const copy = {
      ...el,
      id: generateUUID(),
      x: Math.min(doc.width - 50, el.x + 30),
      y: Math.min(doc.height - 50, el.y + 30),
    };
    change({ ...doc, elements: [...doc.elements, copy] });
    setSelected(copy.id);
    notify("Element duplicated");
  }

  function bringForward(elementId = selected) {
    const el = doc.elements.find((e) => e.id === elementId);
    if (!el) return;
    change({
      ...doc,
      elements: [...doc.elements.filter((e) => e.id !== elementId), el],
    });
    notify("Brought to front");
  }

  function sendBackward(elementId = selected) {
    const el = doc.elements.find((e) => e.id === elementId);
    if (!el) return;
    change({
      ...doc,
      elements: [el, ...doc.elements.filter((e) => e.id !== elementId)],
    });
    notify("Sent to back");
  }

  function rotateElement(degrees: number) {
    if (!element) return;
    const currentRot = element.rotation || 0;
    const nextRot = (currentRot + degrees + 360) % 360;
    patch({ rotation: nextRot });
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        e.preventDefault();
        deleteElement(selected);
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "d" &&
        selected
      ) {
        e.preventDefault();
        duplicateElement(selected);
      } else if (e.key === "Escape" && selected) {
        e.preventDefault();
        setSelected("");
      } else if (
        selected &&
        element &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowUp") patch({ y: element.y - step });
        if (e.key === "ArrowDown") patch({ y: element.y + step });
        if (e.key === "ArrowLeft") patch({ x: element.x - step });
        if (e.key === "ArrowRight") patch({ x: element.x + step });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, element, doc]);

  async function handleDirectImageUpload(file: File) {
    setUploadingImg(true);
    try {
      const asset = await uploadMedia(file, "Studio canvas upload");
      await reload();
      // Drop onto canvas preserving image's natural aspect ratio
      const naturalW = asset.width || 1920;
      const naturalH = asset.height || 1080;
      const assetRatio = naturalW / naturalH;
      const maxW = Math.round(doc.width * 0.9);
      const maxH = Math.round(doc.height * 0.9);
      let imgW = maxW;
      let imgH = Math.round(imgW / assetRatio);
      if (imgH > maxH) {
        imgH = maxH;
        imgW = Math.round(imgH * assetRatio);
      }
      const e = makeElement("image", {
        assetId: asset.id,
        width: Math.round(imgW),
        height: Math.round(imgH),
        x: Math.round((doc.width - imgW) / 2),
        y: Math.round((doc.height - imgH) / 2),
        fit: "cover",
      });
      change({ ...doc, elements: [...doc.elements, e] });
      setSelected(e.id);
      notify("Image added to canvas!");
    } catch (err: any) {
      notify(err.message || "Failed to upload image");
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function save(publish = false) {
    setBusy(true);
    try {
      const d = await api(
        id ? "designs/" + id : "designs",
        id ? "PATCH" : "POST",
        { name, document: doc, ...(id ? { revision } : {}) },
      );
      setId(d.id);
      setRevision(d.revision);
      setDirty(false);
      if (publish) {
        const v = await api("designs/" + d.id + "/publish", "POST", {});
        notify(
          "Published version " +
            v.version +
            ". Assign it from Content or Screens.",
        );
      } else notify("Draft saved.");
      await reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CREATE SOMETHING WORTH SEEING</p>
          <h1>Content studio</h1>
          <p>Designed at the Club. Beautiful on every screen.</p>
        </div>
        <div className="actions">
          <button onClick={() => setPreview(!preview)}>
            {preview ? "Edit design" : "Exact preview"}
          </button>
          <button disabled={busy} onClick={() => save()}>
            Save draft
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => save(true)}
          >
            Publish version
          </button>
        </div>
      </div>

      <div className="studio-toolbar">
        <label>
          Design name
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label>
          Open draft
          <select
            value={id}
            onChange={(e) => {
              if (dirty && !confirm("Discard unsaved changes?")) return;
              const d = state.designs.find((d: any) => d.id === e.target.value);
              if (d) {
                setId(d.id);
                setRevision(d.revision);
                setName(d.name);
                setDoc(d.document);
                setUndo([]);
                setRedo([]);
                setDirty(false);
              }
            }}
          >
            <option value="">New design</option>
            {state.designs.map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Canvas
          <select
            value={doc.width}
            onChange={(e) => {
              const landscape = e.target.value === "1920";
              change({
                ...doc,
                width: landscape ? 1920 : 1080,
                height: landscape ? 1080 : 1920,
              });
            }}
          >
            <option value="1920">Landscape · 1920 × 1080 (TV Standard)</option>
            <option value="1080">Portrait · 1080 × 1920 (Mounted Vertical)</option>
          </select>
        </label>
        <span className="badge">
          {dirty ? "Unsaved changes" : id ? "Saved draft" : "New design"}
        </span>
      </div>

      <div className={"studio-grid " + (preview ? "previewing" : "")}>
        <aside className="panel studio-tools">
          <h3>Add to canvas</h3>
          <div className="tool-grid">
            {(["text", "video", "rect", "qr", "clock"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  const e = makeElement(type, {
                    text:
                      type === "text"
                        ? "Your announcement here"
                        : type === "qr"
                          ? "https://example.com"
                          : "",
                    width: type === "video" ? (doc.width === 1920 ? 960 : 720) : 880,
                    height: type === "video" ? (doc.width === 1920 ? 540 : 405) : 160,
                  });
                  change({ ...doc, elements: [...doc.elements, e] });
                  setSelected(e.id);
                }}
              >
                {type === "text"
                  ? "✍️ Text"
                  : type === "video"
                    ? "🎬 Video"
                    : type === "rect"
                      ? "⬛ Shape"
                      : type === "qr"
                        ? "📱 QR Code"
                        : "🕒 Clock"}
              </button>
            ))}
          </div>

          <div style={{ marginTop: "10px" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleDirectImageUpload(f);
              }}
            />
            <button
              type="button"
              className="btn-upload-photo"
              disabled={uploadingImg}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingImg ? "Uploading photo…" : "📷 Upload & Insert Photo"}
            </button>
          </div>

          <hr className="divider" style={{ margin: "16px 0" }} />

          <h3>Canvas background</h3>
          <SwatchPicker
            value={doc.background}
            onChange={(hex) => change({ ...doc, background: hex })}
          />

          <label className="check" style={{ marginTop: "12px" }}>
            <input
              type="checkbox"
              checked={!!doc.gradient}
              onChange={(e) =>
                change({
                  ...doc,
                  gradient: e.target.checked ? "#e8dcce" : undefined,
                })
              }
            />
            Add background gradient
          </label>
          {doc.gradient && (
            <SwatchPicker
              label="Gradient secondary colour"
              value={doc.gradient}
              onChange={(hex) => change({ ...doc, gradient: hex })}
            />
          )}

          <label className="check" style={{ marginTop: "8px" }}>
            <input
              type="checkbox"
              checked={guides}
              onChange={(e) => setGuides(e.target.checked)}
            />
            Safe-area guides
          </label>

          <hr className="divider" style={{ margin: "16px 0" }} />

          <h3>Starter templates</h3>
          <div className="template-cards-list">
            {templateNames.map((t) => {
              const meta = TEMPLATE_META[t] || { icon: "✨", category: "Layout" };
              return (
                <button
                  className="template-choice-card"
                  key={t}
                  type="button"
                  onClick={() => {
                    if (dirty && !confirm("Replace this design with " + t + "?"))
                      return;
                    setId("");
                    setName(t);
                    change(template(t, doc.width === 1920));
                    setSelected("");
                  }}
                >
                  <span className="template-icon">{meta.icon}</span>
                  <div className="template-meta">
                    <strong>{t}</strong>
                    <span className="template-tag">{meta.category}</span>
                  </div>
                  <span className="template-arrow">↗</span>
                </button>
              );
            })}
          </div>

          <div className="actions" style={{ marginTop: "16px" }}>
            <button
              type="button"
              disabled={!undo.length}
              onClick={() => {
                setRedo((s) => [doc, ...s]);
                setDoc(undo[undo.length - 1]);
                setUndo((s) => s.slice(0, -1));
                setDirty(true);
              }}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!redo.length}
              onClick={() => {
                setUndo((s) => [...s, doc]);
                setDoc(redo[0]);
                setRedo((s) => s.slice(1));
                setDirty(true);
              }}
            >
              Redo
            </button>
          </div>
          <button
            type="button"
            style={{ marginTop: "8px", width: "100%" }}
            onClick={() => {
              setId("");
              setName(name + " — copy");
              setDirty(true);
            }}
          >
            Duplicate design
          </button>
        </aside>

        <div className="canvas-workspace">
          {element && !preview && (
            <div className="canva-floating-bar">
              <span className="floating-badge">
                {element.type === "image"
                  ? "🖼️ Image"
                  : element.type === "video"
                    ? "🎬 Video"
                    : element.type === "text"
                      ? "✍️ Text"
                      : element.type === "rect"
                        ? "⬛ Shape"
                        : element.type === "qr"
                          ? "📱 QR"
                          : "🕒 Clock"}
              </span>
              <button
                type="button"
                className="btn-canva-action"
                title="Duplicate (Cmd+D)"
                onClick={() => duplicateElement()}
              >
                📋 Duplicate
              </button>
              <button
                type="button"
                className="btn-canva-action"
                title="Rotate 90° Clockwise"
                onClick={() => rotateElement(90)}
              >
                ↻ 90°
              </button>
              <button
                type="button"
                className="btn-canva-action"
                title="Bring Forward"
                onClick={() => bringForward()}
              >
                ⬆ Forward
              </button>
              <button
                type="button"
                className="btn-canva-action"
                title="Send Backward"
                onClick={() => sendBackward()}
              >
                ⬇ Backward
              </button>
              <button
                type="button"
                className="btn-canva-delete"
                title="Delete Element (Delete / Backspace key)"
                onClick={() => deleteElement()}
              >
                🗑️ Delete
              </button>
              <button
                type="button"
                className="btn-canva-close"
                title="Deselect (Esc)"
                onClick={() => setSelected("")}
              >
                ✕
              </button>
            </div>
          )}
          <div className="canvas-sheet">
            <CanvasRenderer
              document={doc}
              width={canvasWidth}
              selected={preview ? undefined : selected}
              onSelect={preview ? undefined : setSelected}
              onChange={
                preview
                  ? undefined
                  : (e) =>
                      change({
                        ...doc,
                        elements: doc.elements.map((x) =>
                          x.id === e.id ? e : x,
                        ),
                      })
              }
              guides={!preview && guides}
              assets={Object.fromEntries(
                state.media.map((m: any) => [
                  m.id,
                  `/api/v1/media/${m.id}/file`,
                ]),
              )}
              onError={notify}
            />
          </div>
          <small>
            {doc.width} × {doc.height} ·{" "}
            {preview
              ? "Live TV rendering preview"
              : "Drag or resize elements directly on canvas"}
          </small>
        </div>

        <aside className="panel studio-properties">
          <h3>{element ? "Selected element" : "Layers"}</h3>
          {element ? (
            <>
              {/* Canva Top Action Bar: Delete & Duplicate */}
              <div className="element-top-actions">
                <button
                  type="button"
                  className="btn-delete-element"
                  title="Delete element from canvas (Delete / Backspace key)"
                  onClick={() => deleteElement()}
                >
                  🗑️ Delete Element
                </button>
                <button
                  type="button"
                  className="btn-duplicate-element"
                  title="Duplicate element (Cmd+D)"
                  onClick={() => duplicateElement()}
                >
                  📋 Duplicate
                </button>
              </div>

              {/* Quick Rotation (All 4 Angles) */}
              <div className="prop-block">
                <span className="prop-subtitle">Rotation (All 4 Angles)</span>
                <div className="quick-layout-grid">
                  <button
                    type="button"
                    title="Standard 0°"
                    onClick={() => patch({ rotation: 0 })}
                  >
                    0° Standard
                  </button>
                  <button
                    type="button"
                    title="Rotate 90° Clockwise"
                    onClick={() => patch({ rotation: 90 })}
                  >
                    ↻ 90° CW
                  </button>
                  <button
                    type="button"
                    title="Invert 180°"
                    onClick={() => patch({ rotation: 180 })}
                  >
                    🔄 180° Invert
                  </button>
                  <button
                    type="button"
                    title="Rotate 270° Counter-Clockwise"
                    onClick={() => patch({ rotation: 270 })}
                  >
                    ↺ 270° CCW
                  </button>
                </div>
              </div>

              {/* 1-Click Positioning & Alignment */}
              <div className="prop-block">
                <span className="prop-subtitle">1-Click Layout</span>
                <div className="quick-layout-grid">
                  <button
                    type="button"
                    title="Center Horizontally"
                    onClick={() =>
                      patch({
                        x: Math.round((doc.width - element.width) / 2),
                      })
                    }
                  >
                    ↔ Center H
                  </button>
                  <button
                    type="button"
                    title="Center Vertically"
                    onClick={() =>
                      patch({
                        y: Math.round((doc.height - element.height) / 2),
                      })
                    }
                  >
                    ↕ Center V
                  </button>
                  <button
                    type="button"
                    title="Center on Canvas"
                    onClick={() =>
                      patch({
                        x: Math.round((doc.width - element.width) / 2),
                        y: Math.round((doc.height - element.height) / 2),
                      })
                    }
                  >
                    🎯 Center Both
                  </button>
                  <button
                    type="button"
                    title="Make Fullscreen"
                    onClick={() =>
                      patch({
                        x: 0,
                        y: 0,
                        width: doc.width,
                        height: doc.height,
                      })
                    }
                  >
                    ⛶ Fullscreen
                  </button>
                  <button
                    type="button"
                    title="Fit Full Width"
                    onClick={() => patch({ x: 0, width: doc.width })}
                  >
                    ═ Full Width
                  </button>
                  <button
                    type="button"
                    title="Top Banner"
                    onClick={() => patch({ x: 0, y: 0, width: doc.width })}
                  >
                    ⬆ Top Banner
                  </button>
                </div>
              </div>

              {/* Text Value */}
              {(element.type === "text" || element.type === "qr") && (
                <label>
                  {element.type === "qr" ? "QR Link URL" : "Text Content"}
                  <textarea
                    rows={3}
                    value={element.text}
                    onChange={(e) => patch({ text: e.target.value })}
                  />
                </label>
              )}

              {/* Text Size Presets & Steppers */}
              {element.type === "text" && (
                <div className="prop-block">
                  <span className="prop-subtitle">Text Style Presets</span>
                  <div className="quick-layout-grid">
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          fontSize: 92,
                          fontFamily: "Cormorant Garamond",
                          bold: true,
                        })
                      }
                    >
                      Title (92px)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          fontSize: 60,
                          fontFamily: "Cormorant Garamond",
                          bold: true,
                        })
                      }
                    >
                      Heading (60px)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          fontSize: 36,
                          fontFamily: "Plus Jakarta Sans",
                          bold: false,
                        })
                      }
                    >
                      Subhead (36px)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          fontSize: 24,
                          fontFamily: "Plus Jakarta Sans",
                          bold: false,
                        })
                      }
                    >
                      Body (24px)
                    </button>
                  </div>
                  <div className="size-stepper-row">
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() =>
                        patch({ fontSize: Math.max(10, element.fontSize - 4) })
                      }
                    >
                      A-
                    </button>
                    <span className="stepper-val">{element.fontSize}px</span>
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() =>
                        patch({ fontSize: Math.min(260, element.fontSize + 4) })
                      }
                    >
                      A+
                    </button>
                  </div>
                </div>
              )}

              {/* Color Swatches */}
              <div className="prop-block">
                <SwatchPicker
                  label={
                    element.type === "rect" ? "Shape fill colour" : "Text colour"
                  }
                  value={element.fill}
                  onChange={(hex) => patch({ fill: hex })}
                />
              </div>

              {/* Font & Alignment */}
              {element.type === "text" && (
                <>
                  <label>
                    Font Family
                    <select
                      value={element.fontFamily}
                      onChange={(e) =>
                        patch({
                          fontFamily: e.target.value as Element["fontFamily"],
                        })
                      }
                    >
                      <option>Cormorant Garamond</option>
                      <option>Plus Jakarta Sans</option>
                    </select>
                  </label>
                  <label>
                    Alignment
                    <select
                      value={element.align}
                      onChange={(e) =>
                        patch({ align: e.target.value as Element["align"] })
                      }
                    >
                      <option value="left">Align Left</option>
                      <option value="center">Align Center</option>
                      <option value="right">Align Right</option>
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={element.bold}
                      onChange={(e) => patch({ bold: e.target.checked })}
                    />
                    Bold text
                  </label>
                </>
              )}

              {/* Image Picker & Aspect Ratio Controls */}
              {element.type === "image" && (() => {
                const currentAsset = state.media.find((m: any) => m.id === element.assetId);
                const assetRatio = currentAsset?.width && currentAsset?.height ? currentAsset.width / currentAsset.height : null;
                const canvasRatio = doc.width / doc.height;
                const isRatioMismatch = assetRatio !== null && Math.abs(assetRatio - canvasRatio) > 0.04;

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <label>
                      Choose Image
                      <select
                        value={element.assetId || element.brandAsset || ""}
                        onChange={(e) => {
                          const target = state.media.find((m: any) => m.id === e.target.value);
                          if (target) {
                            patch({
                              assetId: target.id,
                              brandAsset: undefined,
                            });
                          } else {
                            patch({
                              brandAsset: e.target.value as Element["brandAsset"],
                              assetId: undefined,
                            });
                          }
                        }}
                      >
                        <option value="crest">Club Crest</option>
                        <option value="tennis">Tennis Photography</option>
                        <option value="waterfront">Waterfront Photography</option>
                        {state.media.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name} {m.width ? `(${m.width}×${m.height})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    {/* Aspect Ratio Analysis & Notification */}
                    {currentAsset?.width && currentAsset?.height && (
                      <div
                        style={{
                          background: isRatioMismatch ? "#fffbeb" : "#f0fdf4",
                          border: "1px solid " + (isRatioMismatch ? "#fde68a" : "#bbf7d0"),
                          borderRadius: 6,
                          padding: "8px 10px",
                          fontSize: 11,
                          color: isRatioMismatch ? "#92400e" : "#166534",
                          lineHeight: 1.4,
                        }}
                      >
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                          <span>{isRatioMismatch ? "⚠️" : "✓"}</span>
                          <span>
                            {isRatioMismatch
                              ? `Aspect Ratio Mismatch (${assetRatio?.toFixed(2)}:1 vs ${canvasRatio.toFixed(2)}:1)`
                              : "Aspect Ratio Matches Screen Perfectly"}
                          </span>
                        </div>
                        <div style={{ marginTop: 3, opacity: 0.9 }}>
                          Native image: <strong>{currentAsset.width} × {currentAsset.height} px</strong>
                          {isRatioMismatch && (
                            <span>
                              . Select <strong>Fill (Cover)</strong> below to fill the TV screen edge-to-edge without black borders.
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Display Mode / Fit Selector */}
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 }}>
                        Screen Fit & Aspect Ratio Mode
                      </span>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        <button
                          type="button"
                          style={{
                            padding: "6px 2px",
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 4,
                            border: "1px solid " + (element.fit === "cover" ? "var(--navy)" : "#cbd5e1"),
                            background: element.fit === "cover" ? "var(--navy)" : "#fff",
                            color: element.fit === "cover" ? "#fff" : "#1e293b",
                            cursor: "pointer",
                          }}
                          onClick={() => patch({ fit: "cover" })}
                          title="Cover: Fills the entire element/screen edge-to-edge with no black bars"
                        >
                          🖼️ Fill (Cover)
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: "6px 2px",
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 4,
                            border: "1px solid " + (!element.fit || element.fit === "contain" ? "var(--navy)" : "#cbd5e1"),
                            background: !element.fit || element.fit === "contain" ? "var(--navy)" : "#fff",
                            color: !element.fit || element.fit === "contain" ? "#fff" : "#1e293b",
                            cursor: "pointer",
                          }}
                          onClick={() => patch({ fit: "contain" })}
                          title="Contain: Fits the entire image inside with letterbox bars if aspect ratio doesn't match"
                        >
                          🔲 Fit All (Contain)
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: "6px 2px",
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 4,
                            border: "1px solid " + (element.fit === "fill" ? "var(--navy)" : "#cbd5e1"),
                            background: element.fit === "fill" ? "var(--navy)" : "#fff",
                            color: element.fit === "fill" ? "#fff" : "#1e293b",
                            cursor: "pointer",
                          }}
                          onClick={() => patch({ fit: "fill" })}
                          title="Stretch: Stretches image to exact element width and height"
                        >
                          ↔️ Stretch (Fill)
                        </button>
                      </div>
                    </div>

                    {/* Quick Alignment / Aspect Ratio Buttons */}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn-stepper"
                        style={{ flex: 1, padding: "7px 4px", fontSize: 11, height: "auto" }}
                        onClick={() => {
                          patch({
                            x: 0,
                            y: 0,
                            width: doc.width,
                            height: doc.height,
                            fit: "cover",
                          });
                          notify("Image expanded to Fullscreen (16:9)!");
                        }}
                        title="Set element to full screen canvas size with cover fit"
                      >
                        📺 Fullscreen {doc.width > doc.height ? "16:9" : "9:16"}
                      </button>
                      {currentAsset?.width && currentAsset?.height && (
                        <button
                          type="button"
                          className="btn-stepper"
                          style={{ flex: 1, padding: "7px 4px", fontSize: 11, height: "auto" }}
                          onClick={() => {
                            const ar = currentAsset.width / currentAsset.height;
                            let newW: number = doc.width;
                            let newH: number = Math.round(newW / ar);
                            if (newH > doc.height) {
                              newH = doc.height;
                              newW = Math.round(newH * ar);
                            }
                            patch({
                              width: newW,
                              height: newH,
                              x: Math.round((doc.width - newW) / 2),
                              y: Math.round((doc.height - newH) / 2),
                              fit: "contain",
                            });
                            notify(`Proportions matched to ${currentAsset.width}×${currentAsset.height}`);
                          }}
                          title="Set element bounds to match image's natural aspect ratio"
                        >
                          📐 Match Image Ratio
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Video Picker & Options */}
              {element.type === "video" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
                  <label>
                    Choose Video
                    <select
                      value={element.assetId || ""}
                      onChange={(e) => patch({ assetId: e.target.value })}
                    >
                      <option value="">Select a video asset...</option>
                      {state.media
                        .filter((m: any) => m.mime_type?.startsWith("video/"))
                        .map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      {/* Fallback to all media if mime_type filter is empty */}
                      {state.media
                        .filter((m: any) => !m.mime_type?.startsWith("video/"))
                        .map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.mime_type})
                          </option>
                        ))}
                    </select>
                  </label>

                  {/* Video Fit Mode */}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 5 }}>
                      Video Fit Mode
                    </span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        type="button"
                        style={{
                          padding: "6px 2px",
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 4,
                          border: "1px solid " + (element.fit === "cover" ? "var(--navy)" : "#cbd5e1"),
                          background: element.fit === "cover" ? "var(--navy)" : "#fff",
                          color: element.fit === "cover" ? "#fff" : "#1e293b",
                          cursor: "pointer",
                        }}
                        onClick={() => patch({ fit: "cover" })}
                      >
                        🎬 Fill (Cover)
                      </button>
                      <button
                        type="button"
                        style={{
                          padding: "6px 2px",
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 4,
                          border: "1px solid " + (!element.fit || element.fit === "contain" ? "var(--navy)" : "#cbd5e1"),
                          background: !element.fit || element.fit === "contain" ? "var(--navy)" : "#fff",
                          color: !element.fit || element.fit === "contain" ? "#fff" : "#1e293b",
                          cursor: "pointer",
                        }}
                        onClick={() => patch({ fit: "contain" })}
                      >
                        🔲 Fit All (Contain)
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-stepper"
                    style={{ padding: "7px 4px", fontSize: 11, height: "auto" }}
                    onClick={() => {
                      patch({
                        x: 0,
                        y: 0,
                        width: doc.width,
                        height: doc.height,
                        fit: "cover",
                      });
                      notify("Video expanded to Fullscreen (16:9)!");
                    }}
                  >
                    📺 Fullscreen {doc.width > doc.height ? "16:9" : "9:16"}
                  </button>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={element.muted ?? true}
                      onChange={(e) => patch({ muted: e.target.checked })}
                    />
                    Mute video audio (Recommended for signage)
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={element.loop ?? true}
                      onChange={(e) => patch({ loop: e.target.checked })}
                    />
                    Loop video continuously
                  </label>
                </div>
              )}

              {/* Collapsible Advanced Coordinates */}
              <div className="advanced-toggle">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setShowCoords(!showCoords)}
                >
                  {showCoords ? "▾ Hide pixel coordinates" : "▸ Advanced pixel coordinates"}
                </button>
              </div>

              {showCoords && (
                <div className="two" style={{ marginTop: "8px" }}>
                  {(
                    ["x", "y", "width", "height", "rotation", "fontSize"] as const
                  ).map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        type="number"
                        value={element[key]}
                        onChange={(e) =>
                          patch({ [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}

              {/* Layer Actions */}
              <div className="actions" style={{ marginTop: "14px" }}>
                <button
                  type="button"
                  onClick={() => {
                    const e = {
                      ...element,
                      id: generateUUID(),
                      x: element.x + 20,
                      y: element.y + 20,
                    };
                    change({ ...doc, elements: [...doc.elements, e] });
                    setSelected(e.id);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    change({
                      ...doc,
                      elements: doc.elements.filter((e) => e.id !== selected),
                    });
                    setSelected("");
                  }}
                >
                  Delete
                </button>
              </div>
              <div className="actions" style={{ marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() =>
                    change({
                      ...doc,
                      elements: [
                        element,
                        ...doc.elements.filter((e) => e.id !== selected),
                      ],
                    })
                  }
                >
                  Send to back
                </button>
                <button
                  type="button"
                  onClick={() =>
                    change({
                      ...doc,
                      elements: [
                        ...doc.elements.filter((e) => e.id !== selected),
                        element,
                      ],
                    })
                  }
                >
                  Bring to front
                </button>
              </div>
            </>
          ) : (
            <p className="muted" style={{ margin: "14px 0" }}>
              Click any item on the canvas to edit, align, or recolor it.
            </p>
          )}

          <hr className="divider" style={{ margin: "20px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>All Canvas Layers ({doc.elements.length})</h3>
            {doc.elements.length > 0 && (
              <button
                type="button"
                className="btn-link"
                style={{ color: "#dc2626", fontSize: "11px" }}
                onClick={() => {
                  if (confirm("Remove all elements from canvas?")) {
                    change({ ...doc, elements: [] });
                    setSelected("");
                    notify("Canvas cleared");
                  }
                }}
              >
                Clear all
              </button>
            )}
          </div>
          <div className="layers-list">
            {[...doc.elements].reverse().map((e) => (
              <div
                className={"layer-row " + (selected === e.id ? "active" : "")}
                key={e.id}
              >
                <button
                  type="button"
                  className={"layer layer-btn " + (selected === e.id ? "active" : "")}
                  onClick={() => setSelected(e.id)}
                >
                  {e.type === "video"
                    ? "🎬 Video"
                    : e.type === "image"
                      ? "🖼️ Image"
                      : e.type === "text"
                        ? "✍️ " + (e.text.slice(0, 18) || "Text")
                        : e.type === "rect"
                          ? "⬛ Shape"
                          : e.type === "qr"
                            ? "📱 QR Code"
                            : "🕒 Clock"}
                </button>
                <button
                  type="button"
                  className="layer-del-btn"
                  title="Delete element"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    deleteElement(e.id);
                  }}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
