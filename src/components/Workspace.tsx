"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Monitor,
  Palette,
  Images,
  Layers,
  CalendarDays,
  Radio,
  Link2,
  Settings,
  ArrowUpRight,
  Plus,
  LogOut,
  Wifi,
  WifiOff,
  Menu,
  X,
  Eye,
  EyeOff,
  Zap,
} from "lucide-react";
import { api, date, prepareImageForUpload } from "./api";
import { Dialog } from "./Dialog";
import {
  template,
  makeElement,
  templateNames,
  torontoTime,
  initialLive,
  type LiveData,
  type Manifest,
  tournamentPresets,
  type TournamentPreset,
  type Sport,
} from "@/shared/content";
const Canvas = dynamic(
  () => import("@/shared/Renderer").then((m) => m.CanvasRenderer),
  { ssr: false },
);
const Player = dynamic(
  () => import("@/shared/Renderer").then((m) => m.DisplayPlayer),
  { ssr: false },
);
const Studio = dynamic(() => import("./Studio").then((m) => m.Studio), {
  ssr: false,
});
// Every refresh wakes the database, so a dashboard left open on an unattended
// computer stops refreshing after 15 minutes without mouse or keyboard use.
let lastActivity = Date.now();
if (typeof window !== "undefined")
  for (const event of ["pointerdown", "pointermove", "keydown", "wheel"])
    window.addEventListener(event, () => (lastActivity = Date.now()), {
      passive: true,
    });
const watching = () =>
  document.visibilityState === "visible" &&
  Date.now() - lastActivity < 15 * 60_000;
const navigation = [
  ["dashboard", "Overview", LayoutDashboard],
  ["screens", "Screens", Monitor],
  ["studio", "Content studio", Palette],
  ["content", "Content library", Images],
  ["groups", "Screen groups", Layers],
  ["schedule", "Schedule", CalendarDays],
  ["live", "Live controls", Radio],
  ["pair", "Pair a screen", Link2],
  ["settings", "Settings", Settings],
] as const;
const empty = {
  screens: [],
  designs: [],
  versions: [],
  playlists: [],
  groups: [],
  boards: [],
  media: [],
  assignments: [],
  history: [],
  members: [],
  templates: [],
  actor: { name: "Administrator" },
};
function Heading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
function Empty({
  title,
  text,
  href,
  label,
}: {
  title: string;
  text: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty">
      <Monitor size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {href && (
        <Link className="button primary" href={href}>
          {label}
        </Link>
      )}
    </div>
  );
}
export function Workspace({
  route,
  detail,
}: {
  route: string;
  detail?: string;
}) {
  const [state, setState] = useState<any>(empty),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [menu, setMenu] = useState(false),
    [publish, setPublish] = useState<boolean | string>(false),
    [quickCast, setQuickCast] = useState(false),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  const notify = useCallback((text: string) => setToast(text), []);
  const reload = useCallback(async () => {
    try {
      setState(await api("state"));
      setLoaded(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (["login", "account"].includes(route)) return;
    void reload();
    const t = setInterval(() => {
      if (watching()) void reload();
    }, 10000);
    return () => clearInterval(t);
  }, [route, reload]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  async function run(fn: () => Promise<unknown>, message = "Changes saved.") {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      notify(message);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (route === "login" || route === "account") return <Account mode={route} />;
  if (route === "display")
    return (
      <ProtectedDisplay
        screenId={
          new URLSearchParams(
            typeof window !== "undefined" ? window.location.search : "",
          ).get("screen") || ""
        }
      />
    );
  const online = state.screens.filter(
    (s: any) =>
      s.last_heartbeat &&
      Date.now() - new Date(s.last_heartbeat).getTime() < 90000 &&
      !s.revoked_at,
  ).length;
  const title = navigation.find((n) => n[0] === route)?.[1] || "Screens";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Link href="/" className="wordmark">
          <img src="/brand/crest.png" alt="OpenScreens logo" />
          <span>
            OPENSCREENS<small>Studio</small>
          </span>
        </Link>
        <p className="sidebar-label">YOUR CLUB, ON DISPLAY</p>
        <nav aria-label="Main navigation">
          {navigation.map(([key, label, Icon]) => (
            <Link
              onClick={() => setMenu(false)}
              href={key === "dashboard" ? "/" : "/" + key}
              key={key}
              className={route === key ? "selected" : ""}
            >
              <Icon size={18} />
              {label}
              {key === "screens" && <span>{state.screens.length}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="connection-dot" />
          Cloud-connected signage<p>Made for life at the Club.</p>
          <button
            onClick={() =>
              void api("auth/logout", "POST", {}).then(() =>
                router.push("/login"),
              )
            }
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={22} />
          </button>
          <span>
            Club workspace <span className="crumb">/ {title}</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <button
              type="button"
              className="btn-quick-cast-top"
              onClick={() => setQuickCast(true)}
            >
              <Zap size={14} /> Quick Cast to TV
            </button>
            <span className="timezone">America / Toronto</span>
            <span className="avatar">
              {state.actor?.name?.slice(0, 1) || "O"}
            </span>
            <span>{state.actor?.name || "Administrator"}</span>
          </div>
        </header>
        <main id="main-content">
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => void reload()}>Retry</button>
            </div>
          )}
          {!loaded && !error ? (
            <div className="empty">Opening your club workspace…</div>
          ) : (
            <>
              {route === "dashboard" && (
                <>
                  <Heading
                    eyebrow="OPENSCREENS · DIGITAL SIGNAGE"
                    title="Your club. On display."
                    subtitle="A welcoming word. A winning point. Every screen, thoughtfully connected."
                  >
                    <Link href="/studio" className="button">
                      Open studio <ArrowUpRight size={16} />
                    </Link>
                    <button
                      className="primary"
                      onClick={() => setPublish(true)}
                    >
                      Publish content <ArrowUpRight size={16} />
                    </button>
                  </Heading>
                  <section className="overview-hero">
                    <div>
                      <span className="eyebrow">A WINDOW INTO CLUB LIFE</span>
                      <h2>
                        The right message.
                        <br />
                        <em>In the right place.</em>
                      </h2>
                      <p>
                        Bring the Club’s moments to every corner.
                        <br />
                        Create once. Publish from anywhere.
                      </p>
                      <Link className="button light" href="/pair">
                        Connect a screen <Plus size={16} />
                      </Link>
                    </div>
                    <div className="hero-photo">
                      <img
                        src="/brand/waterfront.jpg"
                        alt="Venue display"
                      />
                      <div className="photo-caption">
                        VENUE DISPLAY <span>STUDIO & TV RECEIVER</span>
                      </div>
                    </div>
                  </section>
                  <div className="stats">
                    {[
                      [
                        "Connected screens",
                        online + " / " + state.screens.length,
                        "Online right now",
                      ],
                      [
                        "Content library",
                        state.designs.length,
                        "Editable designs",
                      ],
                      [
                        "Published versions",
                        state.versions.length,
                        "Ready for your screens",
                      ],
                      [
                        "Upcoming changes",
                        state.assignments.filter(
                          (a: any) => new Date(a.starts_at) > new Date(),
                        ).length,
                        "Scheduled in Toronto time",
                      ],
                    ].map(([label, value, sub]) => (
                      <div className="stat" key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                        <small>{sub}</small>
                      </div>
                    ))}
                  </div>
                  <div className="section-title">
                    <h2>Your screens</h2>
                    <Link href="/screens">View all screens ↗</Link>
                  </div>
                  {state.screens.length ? (
                    <div className="screen-grid">
                      {state.screens.slice(0, 3).map((s: any) => (
                        <ScreenCard key={s.id} screen={s} />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Your first screen starts here"
                      text="Open the Android TV app, then enter its pairing code to bring your display online."
                      href="/pair"
                      label="Pair your first screen"
                    />
                  )}
                  <div className="section-title">
                    <h2>Made for the moments that matter</h2>
                    <Link href="/studio">Explore the studio ↗</Link>
                  </div>
                  <div className="template-grid">
                    {templateNames.slice(0, 4).map((name, i) => (
                      <Link
                        href={"/studio?template=" + encodeURIComponent(name)}
                        className="template-card"
                        key={name}
                      >
                        <div className={"template-art art-" + i}>
                          <Canvas document={template(name)} width={150} />
                        </div>
                        <h3>{name}</h3>
                        <span>Template collection ↗</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
              {route === "studio" && (
                <Studio state={state} notify={notify} reload={reload} />
              )}
              {route === "screens" && !detail && (
                <>
                  <Heading
                    eyebrow="CONNECTED THROUGH THE CLOUD"
                    title="Every screen, in one place."
                    subtitle="See what is assigned, what has rendered, and what needs attention."
                  >
                    <button
                      type="button"
                      className="btn-quick-cast-accent"
                      onClick={() => setQuickCast(true)}
                    >
                      <Zap size={15} /> Quick Cast (Image / PDF)
                    </button>
                    <Link className="button" href="/pair">
                      Pair screen <Plus size={16} />
                    </Link>
                    <button
                      className="primary"
                      onClick={() => setPublish(true)}
                    >
                      Publish content
                    </button>
                  </Heading>
                  {state.screens.length ? (
                    <div className="screen-grid">
                      {state.screens.map((s: any) => (
                        <ScreenCard key={s.id} screen={s} />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="No screens paired yet"
                      text="Install the TV application to generate a pairing code."
                      href="/pair"
                      label="Pair a screen"
                    />
                  )}
                </>
              )}
              {route === "screens" && detail && (
                <ScreenDetails
                  screen={state.screens.find((s: any) => s.id === detail)}
                  state={state}
                  run={run}
                  busy={busy}
                  onPublish={(contentId?: string) => setPublish(contentId ? contentId : true)}
                />
              )}
              {route === "pair" && <Pair state={state} run={run} busy={busy} />}
              {route === "content" && (
                <Content
                  state={state}
                  run={run}
                  busy={busy}
                  onPublish={(contentId?: string) => setPublish(contentId ? contentId : true)}
                  notify={notify}
                />
              )}
              {route === "groups" && (
                <Groups state={state} run={run} busy={busy} />
              )}
              {route === "schedule" && (
                <>
                  <Heading
                    eyebrow="PLAN AHEAD"
                    title="A little foresight. A seamless day."
                    subtitle="All times are America/Toronto. Overlapping schedules are flagged before publishing."
                  >
                    <button
                      className="primary"
                      onClick={() => setPublish(true)}
                    >
                      Schedule content
                    </button>
                  </Heading>
                  <section className="panel">
                    <h2>Scheduled & priority content</h2>
                    {state.assignments.filter((a: any) =>
                      ["schedule", "priority"].includes(a.kind),
                    ).length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Screen</th>
                              <th>Type</th>
                              <th>Starts</th>
                              <th>Ends</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {state.assignments
                              .filter((a: any) =>
                                ["schedule", "priority"].includes(a.kind),
                              )
                              .map((a: any) => (
                                <tr key={a.id}>
                                  <td>
                                    {
                                      state.screens.find(
                                        (s: any) => s.id === a.screen_id,
                                      )?.name
                                    }
                                  </td>
                                  <td>{a.kind}</td>
                                  <td>{date(a.starts_at)}</td>
                                  <td>
                                    {a.ends_at
                                      ? date(a.ends_at)
                                      : "Until cancelled"}
                                  </td>
                                  <td>
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        confirm("Cancel this assignment?") &&
                                        void run(() =>
                                          api("assignments/" + a.id, "DELETE"),
                                        )
                                      }
                                    >
                                      Cancel
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Room for what’s next"
                        text="Choose published content and set a future start time."
                      />
                    )}
                    <p className="muted">
                      Priority announcements → scheduled content → normal
                      assignment → fallback. Offline TVs keep their last active
                      content until they reconnect.
                    </p>
                  </section>
                </>
              )}
              {route === "live" && (
                <Live
                  state={state}
                  run={run}
                  busy={busy}
                  onPublish={() => setPublish(true)}
                />
              )}
              {route === "settings" && (
                <SettingsPanel
                  state={state}
                  run={run}
                  busy={busy}
                  notify={notify}
                />
              )}
            </>
          )}
        </main>
        <footer>
          OpenScreens <span>DIGITAL SIGNAGE PLATFORM</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {publish && (
        <Publish
          state={state}
          close={() => setPublish(false)}
          run={run}
          busy={busy}
          initialContent={typeof publish === "string" ? publish : undefined}
        />
      )}
      {quickCast && (
        <QuickCastDialog
          state={state}
          close={() => setQuickCast(false)}
          notify={notify}
          reload={reload}
        />
      )}
    </div>
  );
}
function Account({ mode }: { mode: string }) {
  const router = useRouter(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "account") {
        await api("auth/accept", "POST", {
          token: new URLSearchParams(window.location.search).get("token"),
          password,
          name,
        });
        router.push("/login");
      } else {
        await api("auth/login", "POST", { email, password });
        window.location.href = "/";
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="login-story">
        <img
          className="login-photo"
          src="/brand/waterfront.jpg"
          alt="Display background"
        />
        <div>
          <p className="eyebrow">OPENSCREENS · STUDIO</p>
          <h1>
            Club life.
            <br />
            <em>Beautifully displayed.</em>
          </h1>
          <p>A thoughtful welcome, wherever you look.</p>
        </div>
      </section>
      <section className="login-form">
        <img src="/brand/crest.png" alt="OpenScreens logo" />
        <p className="eyebrow">OPENSCREENS</p>
        <h2>
          {mode === "account" ? "Make yourself at home." : "Welcome back."}
        </h2>
        <p>
          {mode === "account"
            ? "Set your name and a secure password."
            : "Sign in to your club workspace."}
        </p>
        <form onSubmit={submit} action="#">
          {mode === "account" ? (
            <label>
              Your name
              <input
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          ) : (
            <label>
              Email address
              <input
                required
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Password</span>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "#606b78",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "12px",
                  padding: "2px 4px",
                }}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                <span>{showPassword ? "Hide" : "Show"}</span>
              </button>
            </div>
            <input
              required
              minLength={mode === "account" ? 12 : 1}
              maxLength={72}
              type={showPassword ? "text" : "password"}
              autoComplete={
                mode === "account" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "account"
                ? "Set up account"
                : "Sign in"}
            <ArrowUpRight size={16} />
          </button>
        </form>
        {mode === "login" && (
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (!email) {
                setError("Enter your email address first.");
                return;
              }
              setBusy(true);
              try {
                await api("auth/reset", "POST", { email });
                setError(
                  "If an account exists, a reset link has been requested.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Forgot your password?
          </button>
        )}
        <small>Private workspace · Invited club staff only</small>
      </section>
    </div>
  );
}
function ScreenCard({ screen: s }: { screen: any }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("screens/" + s.id + "/manifest")
        .then((m) => {
          if (active) setManifest(m);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => watching() && load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [s.id, s.updated_at, s.last_ack?.revision]);
  const online =
    s.last_heartbeat &&
    Date.now() - new Date(s.last_heartbeat).getTime() < 90000 &&
    !s.revoked_at;
  return (
    <Link href={"/screens/" + s.id} className="screen-card">
      <div className="screen-preview">
        {manifest ? (
          <Canvas
            document={manifest.slides[0].document}
            width={manifest.slides[0].document.width === 1920 ? 230 : 135}
            assets={Object.fromEntries(
              Object.entries(manifest.assets).map(([id, a]) => [id, a.url]),
            )}
            live={manifest.slides[0].live}
          />
        ) : (
          <Monitor size={45} />
        )}
        <span className={"status " + (online ? "online" : "offline")}>
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}{" "}
          {s.revoked_at ? "Revoked" : online ? "Online" : "Offline"}
        </span>
      </div>
      <div className="screen-info">
        <h3>
          {s.name}
          <ArrowUpRight size={18} />
        </h3>
        <p>{s.location || "Location not set"}</p>
        <div>
          <span>
            {s.orientation === "landscape"
              ? "Regular (0°)"
              : s.orientation === "landscape-180"
                ? "Regular (180°)"
                : s.orientation === "portrait-cw"
                  ? "Portrait (90° CW)"
                  : "Portrait (270° CCW)"}
          </span>
          <span>
            {manifest && s.last_ack?.revision === manifest.revision
              ? "Render acknowledged"
              : s.last_ack
                ? "Update awaiting render"
                : "Awaiting first render"}
          </span>
        </div>
      </div>
    </Link>
  );
}
function ScreenDetails({
  screen: s,
  state,
  run,
  busy,
  onPublish,
}: {
  screen: any;
  state: any;
  run: any;
  busy: boolean;
  onPublish: () => void;
}) {
  const [m, setM] = useState<Manifest | null>(null),
    [history, setHistory] = useState<any[]>([]),
    [publications, setPublications] = useState<any[]>([]);
  useEffect(() => {
    if (!s) return;
    let active = true;
    const load = () => {
      api("screens/" + s.id + "/manifest").then((r) => active && setM(r));
      api("screens/" + s.id + "/history").then((r) => {
        if (active) {
          setHistory(r.acknowledgements);
          setPublications(r.publications);
        }
      });
    };
    load();
    const t = setInterval(() => watching() && load(), 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [s?.id]);
  if (!s)
    return (
      <Empty
        title="Screen not found"
        text="Choose a screen from the Screens page."
        href="/screens"
        label="All screens"
      />
    );
  return (
    <>
      <Heading
        eyebrow="SCREEN DETAILS"
        title={s.name}
        subtitle={s.location || "Set a location for this screen."}
      >
        <button
          onClick={() =>
            void run(
              () => api("screens/" + s.id + "/refresh", "POST", {}),
              "Refresh queued.",
            )
          }
        >
          Refresh receiver
        </button>
        <button className="primary" onClick={onPublish}>
          Publish content
        </button>
      </Heading>
      <div className="detail-grid">
        <section className="panel">
          <h2>Intended display</h2>
          <div className="detail-preview">
            {m && (
              <Canvas
                document={m.slides[0].document}
                width={m.slides[0].document.width === 1920 ? 430 : 270}
                assets={Object.fromEntries(
                  Object.entries(m.assets).map(([id, a]) => [id, a.url]),
                )}
                live={m.slides[0].live}
              />
            )}
          </div>
          <Link
            className="button"
            href={"/display?screen=" + s.id}
            target="_blank"
          >
            Open exact playback preview ↗
          </Link>
          <p className="muted">
            Preview shows cloud intent. Last acknowledgement below reports what
            the TV successfully rendered.
          </p>
        </section>
        <section className="panel">
          <h2>Screen settings</h2>
          <form
            key={s.updated_at}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() =>
                api("screens/" + s.id, "PATCH", Object.fromEntries(f)),
              );
            }}
          >
            <label>
              Name
              <input name="name" required defaultValue={s.name} />
            </label>
            <label>
              Location
              <input name="location" defaultValue={s.location} />
            </label>
            <label>
              Orientation
              <OrientationSelect value={s.orientation} />
            </label>
            <button disabled={busy} className="primary">
              Save screen
            </button>
          </form>
          <dl className="facts">
            {[
              [
                "Device status",
                s.revoked_at
                  ? "Revoked"
                  : s.last_heartbeat &&
                      Date.now() - new Date(s.last_heartbeat).getTime() < 90000
                    ? "Online"
                    : "Offline",
              ],
              [
                "Assigned content",
                state.designs.find((d: any) => d.id === m?.contentId)?.name ||
                  state.playlists.find((p: any) => p.id === m?.contentId)
                    ?.name ||
                  state.boards.find((b: any) => b.id === m?.contentId)?.name ||
                  "Club welcome",
              ],
              ["Assignment version", m?.revision || "Loading"],
              ["Last render", date(s.last_ack?.receivedAt)],
              ["Acknowledged version", s.last_ack?.revision || "None"],
              ["Last heartbeat", date(s.last_heartbeat)],
              ["Last update", date(s.updated_at)],
              ["App version", s.app_version || "Not reported"],
              ["Resolution", s.resolution || "Not reported"],
              [
                "Next scheduled",
                date(
                  state.assignments
                    .filter(
                      (a: any) =>
                        a.screen_id === s.id &&
                        new Date(a.starts_at) > new Date(),
                    )
                    .sort(
                      (a: any, b: any) =>
                        +new Date(a.starts_at) - +new Date(b.starts_at),
                    )[0]?.starts_at,
                ),
              ],
              ["Last error", s.last_error?.message || "None"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                confirm(
                  "Clear normal content and active priority announcements? Schedules and fallback remain.",
                ) &&
                void run(() => api("screens/" + s.id + "/clear", "POST", {}))
              }
            >
              Clear content
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm(
                  "Revoke this TV? It will stop playback when it reconnects.",
                ) &&
                void run(() => api("screens/" + s.id + "/revoke", "POST", {}))
              }
            >
              Revoke device
            </button>
          </div>
          <Link href="/pair">Replace hardware through pairing ↗</Link>
        </section>
      </div>
      <section className="panel">
        <h2>Publishing history</h2>
        {publications.map((p) => (
          <div className="activity" key={p.id}>
            <div>
              <strong>{p.content_name}</strong>
              <p>
                {p.kind} · {p.actor_name}
                {p.cancelled_at ? " · Cancelled" : ""}
              </p>
            </div>
            <small>{date(p.created_at)}</small>
          </div>
        ))}
        <h2 style={{ marginTop: 28 }}>Recent render acknowledgements</h2>
        {history.length ? (
          history.slice(0, 10).map((h) => (
            <div className="activity" key={h.id}>
              <span>{h.payload.slideId}</span>
              <small>{date(h.created_at)}</small>
              <code>{h.revision}</code>
            </div>
          ))
        ) : (
          <p className="muted">No successful render has been reported yet.</p>
        )}
      </section>
    </>
  );
}
function OrientationSelect({ value = "landscape" }: { value?: string }) {
  const [selected, setSelected] = useState(value);

  const meta = {
    landscape: {
      title: "Horizontal (Standard TV)",
      subtitle: "16:9 Widescreen mount",
      desc: "Mounted horizontally on wall or stand. Content displays full 16:9 widescreen (1920 × 1080).",
      icon: (
        <svg width="46" height="34" viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="44" height="25" rx="3" fill="#070d1e" stroke="#c5a059" strokeWidth="2" />
          <rect x="5" y="5" width="38" height="19" rx="1.5" fill="#1e293b" />
          <text x="24" y="17" fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">16:9</text>
          <path d="M22 28h4v4h-4z" fill="#64748b" />
          <rect x="16" y="32" width="16" height="2" rx="1" fill="#475569" />
        </svg>
      ),
    },
    "landscape-180": {
      title: "Upside Down TV",
      subtitle: "180° Inverted ceiling mount",
      desc: "Mounted upside down on ceiling brackets or hanging pole. Flips screen 180° so content is right-side up.",
      icon: (
        <svg width="46" height="34" viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="16" y="2" width="16" height="2" rx="1" fill="#475569" />
          <path d="M22 4h4v4h-4z" fill="#64748b" />
          <rect x="2" y="8" width="44" height="25" rx="3" fill="#070d1e" stroke="#c5a059" strokeWidth="2" />
          <rect x="5" y="11" width="38" height="19" rx="1.5" fill="#1e293b" />
          <text x="24" y="23" fill="#f59e0b" fontSize="8" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">🔄 180°</text>
        </svg>
      ),
    },
    "portrait-cw": {
      title: "Vertical TV (Right)",
      subtitle: "90° Clockwise mount",
      desc: "Mounted vertically (portrait 9:16). Top of TV is rotated 90° to the right (1080 × 1920).",
      icon: (
        <svg width="34" height="46" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="25" height="44" rx="3" fill="#070d1e" stroke="#c5a059" strokeWidth="2" />
          <rect x="5" y="5" width="19" height="38" rx="1.5" fill="#1e293b" />
          <text x="15" y="20" fill="#94a3b8" fontSize="7" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">9:16</text>
          <text x="15" y="30" fill="#38bdf8" fontSize="8" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">↷ 90°</text>
          <path d="M28 20h4v8h-4z" fill="#64748b" />
        </svg>
      ),
    },
    "portrait-ccw": {
      title: "Vertical TV (Left)",
      subtitle: "270° Counterclockwise mount",
      desc: "Mounted vertically (portrait 9:16). Top of TV is rotated 270° / 90° to the left (1080 × 1920).",
      icon: (
        <svg width="34" height="46" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 20h4v8H4z" fill="#64748b" />
          <rect x="9" y="2" width="25" height="44" rx="3" fill="#070d1e" stroke="#c5a059" strokeWidth="2" />
          <rect x="12" y="5" width="19" height="38" rx="1.5" fill="#1e293b" />
          <text x="21" y="20" fill="#94a3b8" fontSize="7" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">9:16</text>
          <text x="21" y="30" fill="#a855f7" fontSize="8" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">↶ 270°</text>
        </svg>
      ),
    },
  }[selected as "landscape" | "landscape-180" | "portrait-cw" | "portrait-ccw"] || {
    title: "Horizontal (Standard TV)",
    subtitle: "Standard 16:9 landscape mount",
    desc: "Standard widescreen TV orientation.",
    icon: null,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "260px" }}>
          <select
            name="orientation"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{ width: "100%", fontWeight: 600 }}
          >
            <option value="landscape">🖥️ Regular Mount · Standard Landscape (0° Horizontal)</option>
            <option value="landscape-180">🔄 Regular Mount · Inverted (180° Ceiling Mount)</option>
            <option value="portrait-cw">📱 Portrait Mount · Clockwise (90° Vertical Right)</option>
            <option value="portrait-ccw">📱 Portrait Mount · Counterclockwise (270° Vertical Left)</option>
          </select>
        </div>
        <div
          title={meta.title + " - " + meta.subtitle}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            background: "#f8fafc",
            border: "1.5px solid #cbd5e1",
            borderRadius: "8px",
            padding: "6px 14px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: "46px", height: "46px" }}>
            {meta.icon}
          </div>
          <div style={{ lineHeight: 1.25 }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", display: "block" }}>
              {meta.title}
            </span>
            <small style={{ fontSize: "11px", color: "#64748b" }}>
              {meta.subtitle}
            </small>
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: "11px",
          color: "#334155",
          background: "#f1f5f9",
          padding: "7px 12px",
          borderRadius: "6px",
          borderLeft: "3px solid var(--gold-dark, #c5a059)",
          lineHeight: 1.4,
        }}
      >
        💡 <strong>Mount preview:</strong> {meta.desc}
      </div>
    </div>
  );
}
function Pair({ state, run, busy }: { state: any; run: any; busy: boolean }) {
  const [paired, setPaired] = useState(false);
  return (
    <>
      <Heading
        eyebrow="A SIMPLE INTRODUCTION"
        title="Meet your next screen."
        subtitle="Your computer and television can be anywhere. All they need is internet."
      />
      <div className="pair-grid">
        <section className="panel">
          <span className="step-number">01 / CONNECT</span>
          <h2>Enter the code on your TV</h2>
          <p>
            Open the OpenScreens app on the television to generate a code.
            Codes expire after five minutes.
          </p>
          {paired ? (
            <Empty
              title="Your screen is connected"
              text="The television will begin showing its default welcome screen."
              href="/screens"
              label="Manage screens"
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                if (!f.replaceScreenId) delete f.replaceScreenId;
                void run(async () => {
                  await api("pair", "POST", f);
                  setPaired(true);
                }, "Screen paired.");
              }}
            >
              <label>
                Pairing code
                <input
                  name="code"
                  className="pair-code"
                  placeholder="OAK-ABC234"
                  required
                  autoComplete="off"
                  maxLength={10}
                />
              </label>
              <label>
                Screen name
                <input
                  name="name"
                  required
                  placeholder="Tennis pavilion"
                  maxLength={100}
                />
              </label>
              <label>
                Location
                <input
                  name="location"
                  placeholder="Racquet sports"
                  maxLength={100}
                />
              </label>
              <label>
                Orientation
                <OrientationSelect />
              </label>
              <label>
                Six-digit local reset PIN
                <input
                  name="resetPin"
                  required
                  pattern="[0-9]{6}"
                  inputMode="numeric"
                  type="password"
                  maxLength={6}
                />
                <small>
                  Keep this PIN with the club administrator. It protects
                  physical reset.
                </small>
              </label>
              <label>
                Hardware replacement
                <select name="replaceScreenId">
                  <option value="">Create a new screen</option>
                  {state.screens.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      Replace device for {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Connecting…" : "Connect screen"}
                <Link2 size={16} />
              </button>
            </form>
          )}
        </section>
        <section className="pair-explainer">
          <Monitor size={58} />
          <h2>
            Pair once.
            <br />
            <em>Publish from anywhere.</em>
          </h2>
          <ol>
            <li>Install and open the Android TV app.</li>
            <li>Enter its code and name the screen.</li>
            <li>Create content and publish when ready.</li>
          </ol>
          <p>
            No casting. No local IP addresses.
            <br />
            No administrator password on the TV.
          </p>
        </section>
      </div>
    </>
  );
}
function Content({
  state,
  run,
  busy,
  onPublish,
  notify,
}: {
  state: any;
  run: any;
  busy: boolean;
  onPublish: (contentId?: string) => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("designs"),
    [progress, setProgress] = useState<number | null>(null),
    [description, setDescription] = useState(""),
    [items, setItems] = useState<
      { versionId?: string; mediaId?: string; duration: number }[]
    >([]),
    [playlistName, setPlaylistName] = useState(""),
    [playlistId, setPlaylistId] = useState(""),
    [playlistOrientation, setPlaylistOrientation] = useState<
      "landscape" | "landscape-180" | "portrait" | "portrait-cw" | "portrait-ccw"
    >("landscape"),
    [drag, setDrag] = useState<number | null>(null),
    [preview, setPreview] = useState<any>(null),
    [slideshow, setSlideshow] = useState<Manifest | null>(null);
  async function upload(rawFile: File) {
    setProgress(0);
    try {
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
          e.lengthComputable &&
          setProgress(Math.round((e.loaded / e.total) * 90));
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("Upload failed"));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });
      setProgress(95);
      await api("media/finish", "POST", {
        key: ticket.key,
        name: file.name,
        description,
        mime: mimeType,
      });
      await run(async () => {}, isVideo ? "Video ready for your screens and slideshows." : "Image ready for your designs.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setProgress(null);
    }
  }
  return (
    <>
      <Heading
        eyebrow="YOUR CLUB COLLECTION"
        title="Content with a sense of place."
        subtitle="Editable designs, reusable photographs and thoughtfully paced slideshows."
      >
        <Link href="/studio" className="button">
          Create design <Plus size={16} />
        </Link>
        <button className="primary" onClick={() => onPublish()}>
          Publish to screens
        </button>
      </Heading>
      <div className="tabs">
        {["designs", "images", "playlists"].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t === "playlists"
              ? "Slideshows"
              : t === "designs"
                ? "Designs"
                : "Photos & Videos"}
          </button>
        ))}
      </div>
      {tab === "designs" &&
        (state.designs.length ? (
          <div className="template-grid">
            {state.designs.map((d: any) => (
              <article className="template-card" key={d.id}>
                <div className="template-art">
                  <Canvas
                    document={d.document}
                    width={d.document.width === 1920 ? 230 : 150}
                    assets={Object.fromEntries(
                      state.media.map((m: any) => [
                        m.id,
                        `/api/v1/media/${m.id}/file`,
                      ]),
                    )}
                  />
                </div>
                <h3>{d.name}</h3>
                <p>
                  Draft revision {d.revision} ·{" "}
                  {
                    state.versions.filter((v: any) => v.design_id === d.id)
                      .length
                  }{" "}
                  published versions
                </p>
                <div className="actions">
                  <Link className="button" href={`/studio?design=${d.id}`}>
                    Edit
                  </Link>
                  <button onClick={() => setPreview(d.document)}>
                    Preview
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api("designs/" + d.id + "/publish", "POST", {}),
                        "Immutable version published.",
                      )
                    }
                  >
                    Publish version
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Delete design "${d.name}"? This action cannot be undone.`)) {
                        void run(
                          () => api("designs/" + d.id, "DELETE"),
                          "Design deleted.",
                        );
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="A blank canvas, full of possibility"
            text="Start with one of five club templates and make it your own."
            href="/studio"
            label="Create your first design"
          />
        ))}
      {tab === "images" && (
        <>
          <label>
            File description / Caption (optional)
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="Optional internal description / label"
            />
          </label>
          <label className="upload-zone">
            <Images size={28} />
            <strong>
              {progress !== null
                ? `Uploading and preparing · ${progress}%`
                : "Add photos, artwork, or videos (MP4, WebM)"}
            </strong>
            <span>MP4, WebM, MOV, JPEG, PNG, WebP, SVG, AVIF, HEIC · up to 150 MB</span>
            <input
              aria-label="Upload photo or video"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml,image/heic,image/heif,image/avif,video/mp4,video/webm,video/quicktime,video/*"
              disabled={progress !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            {progress !== null && <progress max={100} value={progress} />}
          </label>
          <div className="media-grid">
            {state.media.map((m: any) => {
              const isVid = m.mime_type?.startsWith("video/");
              return (
                <article className="panel" key={m.id} style={{ position: "relative" }}>
                  {isVid ? (
                    <div style={{ position: "relative", width: "100%", height: 160, background: "#070d1e", borderRadius: 4, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <video
                        src={`/api/v1/media/${m.id}/file`}
                        muted
                        preload="metadata"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <span style={{ position: "absolute", top: 8, left: 8, background: "rgba(10, 25, 47, 0.85)", color: "#e8dcce", padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, border: "1px solid rgba(255,255,255,0.15)" }}>
                        🎬 VIDEO
                      </span>
                    </div>
                  ) : (
                    <img
                      src={`/api/v1/media/${m.id}/file?thumb=1`}
                      alt={m.description || m.name}
                    />
                  )}
                  <h3>{m.name}</h3>
                  <p>
                    {isVid ? "Video Clip" : `${m.width} × ${m.height}`} ·{" "}
                    {Number(m.byte_size) > 1024 * 1024
                      ? `${(Number(m.byte_size) / (1024 * 1024)).toFixed(1)} MB`
                      : `${Math.round(Number(m.byte_size) / 1024)} KB`}
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className="primary"
                      style={{ flex: 1 }}
                      onClick={() => onPublish("media:" + m.id)}
                    >
                      Publish
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          `Archive this ${isVid ? "video" : "image"}? Media in use cannot be removed.`,
                        ) && void run(() => api("media/" + m.id, "DELETE"))
                      }
                    >
                      Archive
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      {tab === "playlists" && (
        <div className="detail-grid">
          <section className="panel">
            <h2>Compose a slideshow</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api(
                    "playlists" + (playlistId ? "/" + playlistId : ""),
                    "POST",
                    {
                      name: playlistName,
                      orientation: playlistOrientation,
                      items,
                    },
                  );
                  setItems([]);
                  setPlaylistName("");
                  setPlaylistId("");
                  setPlaylistOrientation("landscape");
                }, "Slideshow version published.");
              }}
            >
              <label>
                Name
                <input
                  required
                  placeholder="e.g. Member Events 2026"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                />
              </label>
              <label>
                Display Format / Screen Rotation
                <select
                  value={playlistOrientation}
                  onChange={(e) => setPlaylistOrientation(e.target.value as any)}
                  style={{ fontWeight: 600 }}
                >
                  <option value="landscape">
                    🖥️ Regular Mount · Standard Landscape 0° (16:9 · 1920 × 1080)
                  </option>
                  <option value="landscape-180">
                    🔄 Regular Mount · Inverted Landscape 180° (16:9 · 1920 × 1080) — Ceiling / inverted mount
                  </option>
                  <option value="portrait-cw">
                    📱 Portrait Mount · Clockwise 90° (9:16 · 1080 × 1920) — Vertical mount right
                  </option>
                  <option value="portrait-ccw">
                    📱 Portrait Mount · Counter-Clockwise 270° (9:16 · 1080 × 1920) — Vertical mount left
                  </option>
                </select>
              </label>
              <label>
                Add a published design or image
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [type, id] = e.target.value.split(":");
                    setItems((s) => [
                      ...s,
                      {
                        [type === "design" ? "versionId" : "mediaId"]: id,
                        duration: 10,
                      },
                    ]);
                  }}
                >
                  <option value="">Choose content…</option>
                  {state.versions.map((v: any) => (
                    <option key={v.id} value={"design:" + v.id}>
                      {v.name} · v{v.version}
                    </option>
                  ))}
                  {state.media.map((m: any) => (
                    <option key={m.id} value={"image:" + m.id}>
                      {m.mime_type?.startsWith("video/") ? "🎬 [Video] " : "🖼️ [Image] "}
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {items.map((item, i) => {
                const mediaItem = state.media.find((m: any) => m.id === item.mediaId);
                const isVid = mediaItem?.mime_type?.startsWith("video/");
                return (
                <div
                  className="playlist-row"
                  key={i}
                  draggable
                  onDragStart={() => setDrag(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (drag === null) return;
                    const next = [...items];
                    next.splice(i, 0, next.splice(drag, 1)[0]);
                    setItems(next);
                    setDrag(null);
                  }}
                >
                  <span>
                    ⠿{" "}
                    {state.versions.find((v: any) => v.id === item.versionId)
                      ? `🎨 ${state.versions.find((v: any) => v.id === item.versionId)?.name}`
                      : mediaItem
                        ? `${isVid ? "🎬 [Video]" : "🖼️"} ${mediaItem.name}`
                        : "Slide"}
                  </span>
                  <label>
                    Seconds
                    <input
                      aria-label={"Slide " + (i + 1) + " duration"}
                      type="number"
                      min={2}
                      max={3600}
                      value={item.duration}
                      onChange={(e) =>
                        setItems(
                          items.map((x, j) =>
                            j === i
                              ? { ...x, duration: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Move slide up"
                    disabled={i === 0}
                    onClick={() => {
                      const n = [...items];
                      [n[i - 1], n[i]] = [n[i], n[i - 1]];
                      setItems(n);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Remove slide"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
              <button disabled={busy || !items.length} className="primary">
                Save slideshow version
              </button>
            </form>
            <p className="muted">
              Loops with a gentle crossfade. Each published version keeps its
              exact designs and images.
            </p>
          </section>
          <section className="panel">
            <h2>Your slideshows</h2>
            {state.playlists.length ? (
              state.playlists.map((p: any) => (
                <div className="activity" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <button
                      onClick={() => {
                        const slides = p.items.map((item: any) => {
                          const v = state.versions.find(
                            (v: any) => v.id === item.design_version_id,
                          );
                          const m = state.media.find(
                            (m: any) => m.id === item.media_id,
                          );
                          const isPortrait = m?.width && m?.height && m.height > m.width;
                          const slideW = isPortrait ? 1080 : 1920;
                          const slideH = isPortrait ? 1920 : 1080;
                          return {
                            id: item.id,
                            document: v?.document ?? {
                              schemaVersion: 1,
                              width: slideW,
                              height: slideH,
                              background: "#070d1e",
                              elements: [
                                makeElement("image", {
                                  x: 0,
                                  y: 0,
                                  width: slideW,
                                  height: slideH,
                                  assetId: item.media_id,
                                  fit: "cover",
                                }),
                              ],
                            },
                            version: v?.version ?? 1,
                            duration: item.duration,
                          };
                        });
                        setSlideshow({
                          schemaVersion: 1,
                          rendererVersion: 1,
                          revision: p.id + ":" + p.revision,
                          assignmentId: null,
                          contentId: p.id,
                          version: p.revision,
                          orientation: "landscape",
                          slides,
                          assets: Object.fromEntries(
                            state.media.map((m: any) => [
                              m.id,
                              {
                                url: "/api/v1/media/" + m.id + "/file",
                                sha256: "",
                              },
                            ]),
                          ),
                          epoch: Date.now(),
                          live: false,
                          commands: [],
                        });
                      }}
                    >
                      Preview
                    </button>
                    <p>
                      {p.items.length} slides · version {p.revision}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => {
                        setPlaylistId(p.id);
                        setPlaylistName(p.name);
                        const firstMedia = state.media.find(
                          (m: any) => m.id === p.items?.[0]?.media_id,
                        );
                        if (firstMedia && firstMedia.height > firstMedia.width) {
                          setPlaylistOrientation("portrait");
                        } else {
                          setPlaylistOrientation("landscape");
                        }
                        setItems(
                          p.items.map((i: any) => ({
                            versionId: i.design_version_id || undefined,
                            mediaId: i.media_id || undefined,
                            duration: i.duration,
                          })),
                        );
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Delete slideshow "${p.name}"?`)) {
                          void run(
                            () => api("playlists/" + p.id, "DELETE"),
                            "Slideshow deleted.",
                          );
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">
                Create your first slideshow using published designs or uploaded
                images.
              </p>
            )}
          </section>
        </div>
      )}
      {slideshow && (
        <Dialog label="Slideshow preview" onClose={() => setSlideshow(null)}>
          <button
            style={{ position: "fixed", right: 20, top: 20, zIndex: 100 }}
            onClick={() => setSlideshow(null)}
          >
            Close preview
          </button>
          <Player manifest={slideshow} />
        </Dialog>
      )}
      {preview && (
        <Dialog label="Exact design preview" onClose={() => setPreview(null)}>
          <button
            className="modal-close"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
          >
            <X />
          </button>
          <h2>Exact design preview</h2>
          <Canvas
            document={preview}
            width={preview.width === 1920 ? 520 : 300}
            assets={Object.fromEntries(
              state.media.map((m: any) => [m.id, `/api/v1/media/${m.id}/file`]),
            )}
          />
        </Dialog>
      )}
    </>
  );
}
function Groups({ state, run, busy }: { state: any; run: any; busy: boolean }) {
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <Heading
        eyebrow="BETTER TOGETHER"
        title="A place for every screen."
        subtitle="Organize screens by location, team or occasion."
      />
      <div className="detail-grid">
        <section className="panel">
          <h2>{id ? "Edit group" : "Create a screen group"}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("groups" + (id ? "/" + id : ""), "POST", {
                  name,
                  screens: selected,
                });
                setName("");
                setSelected([]);
                setId("");
              });
            }}
          >
            <label>
              Group name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tennis Screens"
              />
            </label>
            <fieldset>
              <legend>Screens in this group</legend>
              {state.screens.map((s: any) => (
                <label className="check" key={s.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, s.id]
                          : selected.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
            </fieldset>
            <button className="primary" disabled={busy}>
              Save group
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>Your groups</h2>
          {state.groups.length ? (
            state.groups.map((g: any) => (
              <div className="activity" key={g.id}>
                <div>
                  <h3>{g.name}</h3>
                  <p>{g.screens.length} screens</p>
                </div>
                <button
                  onClick={() => {
                    setId(g.id);
                    setName(g.name);
                    setSelected(g.screens);
                  }}
                >
                  Edit group
                </button>
              </div>
            ))
          ) : (
            <p className="muted">
              Start with Tennis, Food & Beverage, Events or Lobby.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
function Live({
  state,
  run,
  busy,
  onPublish,
}: {
  state: any;
  run: any;
  busy: boolean;
  onPublish: () => void;
}) {
  const [id, setId] = useState(""),
    [data, setData] = useState<LiveData>(initialLive),
    [revision, setRevision] = useState(1),
    [history, setHistory] = useState<any[]>([]),
    [previous, setPrevious] = useState<LiveData | null>(null);
  const board = state.boards.find((b: any) => b.id === id);
  useEffect(() => {
    if (id)
      api("live/" + id)
        .then((r) => setHistory(r.updates))
        .catch(() => {});
  }, [id, state.boards]);
  return (
    <>
      <Heading
        eyebrow="IN THE MOMENT"
        title="The score. As it happens."
        subtitle="Simple manual controls, made for courtside use. Scores change only when you save."
      >
        <button className="primary" onClick={onPublish}>
          Assign live board
        </button>
      </Heading>
      <div className="live-layout">
        <details className="tournament-panel" style={{ gridColumn: "1 / -1", marginBottom: "16px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "16px", color: "var(--navy)", padding: "4px 0" }}>
            🏆 Tournament Format Creator · Batch Court Generator
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const tournamentName = String(f.get("tournamentName") || "").trim();
              const presetId = String(f.get("presetId") || "");
              const versionId = String(f.get("versionId") || "");
              const courtsInput = String(f.get("courts") || "").trim();
              const preset =
                tournamentPresets.find((p) => p.id === presetId) ||
                tournamentPresets[0];
              const courtNames = courtsInput
                ? courtsInput.split(",").map((c) => c.trim()).filter(Boolean)
                : ["Court 1", "Court 2", "Court 3", "Court 4"];
              void run(async () => {
                let lastCreatedId = "";
                let lastData = initialLive;
                let lastRev = 1;
                for (const courtName of courtNames) {
                  const boardName = `${tournamentName} · ${courtName}`;
                  const b = await api("live", "POST", {
                    name: boardName,
                    versionId,
                    data: {
                      ...initialLive,
                      sport: preset.sport,
                      tournament: tournamentName,
                      court: courtName,
                      format: preset.formatName,
                      status: "Ready to play",
                    },
                  });
                  lastCreatedId = b.id;
                  lastData = b.data;
                  lastRev = b.revision;
                }
                if (lastCreatedId) {
                  setId(lastCreatedId);
                  setData(lastData);
                  setRevision(lastRev);
                }
              }, `Created ${courtNames.length} tournament scoreboards for ${tournamentName}`);
            }}
            style={{ marginTop: "16px" }}
          >
            <div className="two">
              <label>
                Tournament name
                <input
                  name="tournamentName"
                  required
                  placeholder="e.g. 2026 Championship Tournament"
                  defaultValue="Club Championships 2026"
                />
              </label>
              <label>
                Sport & scoring preset
                <select name="presetId" defaultValue="tennis-best-of-3">
                  {tournamentPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Active courts (comma separated)
                <input
                  name="courts"
                  required
                  placeholder="Court 1, Court 2, Court 3, Court 4"
                  defaultValue="Court 1, Court 2, Court 3, Court 4"
                />
              </label>
              <label>
                Scoreboard layout template
                <select name="versionId" required>
                  <option value="">Choose published layout…</option>
                  {state.versions.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · v{v.version}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button disabled={busy} className="primary" style={{ marginTop: "12px" }}>
              Generate All Court Scoreboards
            </button>
          </form>
        </details>
        <section className="panel">
          <h2>Choose a live board</h2>
          <label>
            Live board
            <select
              aria-label="Live board"
              value={id}
              onChange={(e) => {
                const b = state.boards.find(
                  (b: any) => b.id === e.target.value,
                );
                setId(e.target.value);
                if (b) {
                  setData(b.data);
                  setRevision(b.revision);
                  setPrevious(null);
                }
              }}
            >
              <option value="">Select a board…</option>
              {state.boards.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>Create a single live board</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  const b = await api("live", "POST", Object.fromEntries(f));
                  setId(b.id);
                  setData(b.data);
                  setRevision(b.revision);
                });
              }}
            >
              <label>
                Board name
                <input name="name" required placeholder="Court 1 scoreboard" />
              </label>
              <label>
                Published scoreboard layout
                <select name="versionId" required>
                  <option value="">Choose published layout…</option>
                  {state.versions.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · v{v.version}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Create live board</button>
            </form>
          </details>
          <p className="muted">
            Create and publish a scoreboard template in the studio first. Staff
            enter all scores manually.
          </p>
        </section>
        {board && (
          <section className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h2 style={{ margin: 0 }}>{board.name}</h2>
              <span className="sport-badge">
                {data.sport === "tennis"
                  ? "🎾 Tennis"
                  : data.sport === "pickleball"
                    ? "🏓 Pickleball"
                    : data.sport === "squash"
                      ? "🎯 Squash"
                      : "🏸 Badminton"}
              </span>
            </div>
            {board.revision !== revision && (
              <div className="error">
                A newer score revision is available.
                <button
                  onClick={() => {
                    setData(board.data);
                    setRevision(board.revision);
                  }}
                >
                  Load latest scores
                </button>
              </div>
            )}
            {/* Quick Scorepad Controller */}
            <div className="scorepad-container">
              <div className="scorepad-header">
                <strong>⚡ Quick Scorepad (Court-side Tap Controls)</strong>
                <small className="muted">{data.court || "Court"} · {data.status || "Ready"}</small>
              </div>
              <div className="scorepad-grid">
                <div className={`scorepad-player-card ${data.serving === "1" ? "active-server" : ""}`}>
                  <div className="scorepad-player-name">
                    {data.serving === "1" ? "● " : ""}{data.player1 || "Player 1"}
                    {data.sport === "pickleball" && data.serving === "1" && ` [S${data.serverNumber || "1"}]`}
                  </div>
                  <div style={{ fontSize: "28px", fontWeight: 700, margin: "6px 0", color: "var(--navy)" }}>
                    {data.score1}
                  </div>
                  <div className="scorepad-btn-group">
                    {data.sport === "tennis" ? (
                      ["0", "15", "30", "40", "Ad"].map((pt) => (
                        <button
                          key={pt}
                          type="button"
                          className={`scorepad-btn ${data.score1 === pt ? "primary" : ""}`}
                          onClick={() => setData({ ...data, score1: pt })}
                        >
                          {pt}
                        </button>
                      ))
                    ) : (
                      <>
                        <button
                          type="button"
                          className="scorepad-btn primary"
                          onClick={() => {
                            const cur = parseInt(data.score1, 10);
                            setData({ ...data, score1: String(isNaN(cur) ? 1 : cur + 1) });
                          }}
                        >
                          +1 Pt
                        </button>
                        <button
                          type="button"
                          className="scorepad-btn"
                          onClick={() => {
                            const cur = parseInt(data.score1, 10);
                            setData({ ...data, score1: String(isNaN(cur) ? 0 : Math.max(0, cur - 1)) });
                          }}
                        >
                          -1 Pt
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="scorepad-btn accent"
                      onClick={() => {
                        const cur = parseInt(data.sets1, 10);
                        setData({
                          ...data,
                          score1: "0",
                          score2: "0",
                          sets1: String(isNaN(cur) ? 1 : cur + 1),
                          status: `Game to ${data.player1 || "Player 1"}`,
                        });
                      }}
                    >
                      +Game
                    </button>
                  </div>
                </div>
                <div className={`scorepad-player-card ${data.serving === "2" ? "active-server" : ""}`}>
                  <div className="scorepad-player-name">
                    {data.serving === "2" ? "● " : ""}{data.player2 || "Player 2"}
                    {data.sport === "pickleball" && data.serving === "2" && ` [S${data.serverNumber || "1"}]`}
                  </div>
                  <div style={{ fontSize: "28px", fontWeight: 700, margin: "6px 0", color: "var(--navy)" }}>
                    {data.score2}
                  </div>
                  <div className="scorepad-btn-group">
                    {data.sport === "tennis" ? (
                      ["0", "15", "30", "40", "Ad"].map((pt) => (
                        <button
                          key={pt}
                          type="button"
                          className={`scorepad-btn ${data.score2 === pt ? "primary" : ""}`}
                          onClick={() => setData({ ...data, score2: pt })}
                        >
                          {pt}
                        </button>
                      ))
                    ) : (
                      <>
                        <button
                          type="button"
                          className="scorepad-btn primary"
                          onClick={() => {
                            const cur = parseInt(data.score2, 10);
                            setData({ ...data, score2: String(isNaN(cur) ? 1 : cur + 1) });
                          }}
                        >
                          +1 Pt
                        </button>
                        <button
                          type="button"
                          className="scorepad-btn"
                          onClick={() => {
                            const cur = parseInt(data.score2, 10);
                            setData({ ...data, score2: String(isNaN(cur) ? 0 : Math.max(0, cur - 1)) });
                          }}
                        >
                          -1 Pt
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="scorepad-btn accent"
                      onClick={() => {
                        const cur = parseInt(data.sets2, 10);
                        setData({
                          ...data,
                          score1: "0",
                          score2: "0",
                          sets2: String(isNaN(cur) ? 1 : cur + 1),
                          status: `Game to ${data.player2 || "Player 2"}`,
                        });
                      }}
                    >
                      +Game
                    </button>
                  </div>
                </div>
              </div>
              <div className="scorepad-quick-actions">
                {data.sport === "tennis" && (
                  <button
                    type="button"
                    className="scorepad-btn"
                    onClick={() => setData({ ...data, score1: "40", score2: "40", status: "Deuce" })}
                  >
                    Deuce (40-40)
                  </button>
                )}
                {data.sport === "pickleball" && (
                  <button
                    type="button"
                    className="scorepad-btn accent"
                    onClick={() => {
                      if (data.serving === "1") {
                        if (data.serverNumber === "1") {
                          setData({ ...data, serverNumber: "2" });
                        } else {
                          setData({ ...data, serving: "2", serverNumber: "1" });
                        }
                      } else if (data.serving === "2") {
                        if (data.serverNumber === "1") {
                          setData({ ...data, serverNumber: "2" });
                        } else {
                          setData({ ...data, serving: "1", serverNumber: "1" });
                        }
                      } else {
                        setData({ ...data, serving: "1", serverNumber: "1" });
                      }
                    }}
                  >
                    Side Out
                  </button>
                )}
                {(data.sport === "squash" || data.sport === "badminton") && (
                  <button
                    type="button"
                    className="scorepad-btn"
                    onClick={() =>
                      setData({
                        ...data,
                        serving: data.serving === "1" ? "2" : "1",
                      })
                    }
                  >
                    Service Change
                  </button>
                )}
                {["In Progress", "Game Point", "Match Point", "Final"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`scorepad-btn ${data.status === st ? "primary" : ""}`}
                    onClick={() => setData({ ...data, status: st })}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const b = await api("live/" + id, "PATCH", {
                    data,
                    revision,
                  });
                  setPrevious(board.data);
                  setRevision(b.revision);
                }, "Live scores updated.");
              }}
            >
              <div className="two" style={{ marginBottom: "14px" }}>
                <label>
                  Sport
                  <select
                    value={data.sport || "tennis"}
                    onChange={(e) =>
                      setData({ ...data, sport: e.target.value as Sport })
                    }
                  >
                    <option value="tennis">🎾 Tennis</option>
                    <option value="pickleball">🏓 Pickleball</option>
                    <option value="squash">🎯 Squash</option>
                    <option value="badminton">🏸 Badminton</option>
                  </select>
                </label>
                {data.sport === "pickleball" ? (
                  <label>
                    Server # (Doubles)
                    <select
                      value={data.serverNumber || "1"}
                      onChange={(e) =>
                        setData({
                          ...data,
                          serverNumber: e.target.value as "1" | "2",
                        })
                      }
                    >
                      <option value="1">Server 1</option>
                      <option value="2">Server 2</option>
                    </select>
                  </label>
                ) : (
                  <label>
                    Match format
                    <input
                      value={data.format || ""}
                      placeholder="e.g. Best of 3, PAR-11"
                      onChange={(e) =>
                        setData({ ...data, format: e.target.value })
                      }
                    />
                  </label>
                )}
              </div>
              <div className="two">
                {(
                  [
                    "tournament",
                    "court",
                    "player1",
                    "player2",
                    "score1",
                    "score2",
                    "sets1",
                    "sets2",
                    "status",
                    "nextMatch",
                  ] as const
                ).map((key) => {
                  const labelText =
                    key === "player1"
                      ? data.sport === "pickleball"
                        ? "Team one"
                        : "Player / team one"
                      : key === "player2"
                        ? data.sport === "pickleball"
                          ? "Team two"
                          : "Player / team two"
                        : key === "score1"
                          ? data.sport === "tennis"
                            ? "Current game · one (15, 30, 40, Ad)"
                            : data.sport === "pickleball"
                              ? "Points · one"
                              : "Points · one (current game)"
                          : key === "score2"
                            ? data.sport === "tennis"
                              ? "Current game · two (15, 30, 40, Ad)"
                              : data.sport === "pickleball"
                                ? "Points · two"
                                : "Points · two (current game)"
                            : key === "sets1"
                              ? data.sport === "tennis"
                                ? "Set scores · one"
                                : "Games won · one"
                              : key === "sets2"
                                ? data.sport === "tennis"
                                  ? "Set scores · two"
                                  : "Games won · two"
                                : key === "nextMatch"
                                  ? "Next match"
                                  : key === "court"
                                    ? "Court"
                                    : key === "status"
                                      ? "Match status"
                                      : "Tournament";
                  return (
                    <label key={key}>
                      {labelText}
                      <input
                        className={key.startsWith("score") ? "score-input" : ""}
                        value={data[key]}
                        maxLength={
                          key.startsWith("score")
                            ? 20
                            : key.startsWith("sets")
                              ? 40
                              : 120
                        }
                        onChange={(e) =>
                          setData({ ...data, [key]: e.target.value })
                        }
                      />
                    </label>
                  );
                })}
              </div>
              <label>
                Serving
                <select
                  value={data.serving}
                  onChange={(e) =>
                    setData({
                      ...data,
                      serving: e.target.value as LiveData["serving"],
                    })
                  }
                >
                  <option value="none">Not indicated</option>
                  <option value="1">
                    {data.sport === "pickleball" ? "Team one" : "Player / team one"}
                  </option>
                  <option value="2">
                    {data.sport === "pickleball" ? "Team two" : "Player / team two"}
                  </option>
                </select>
              </label>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || board.revision !== revision}
                >
                  Save scores to screens
                </button>
                <button
                  type="button"
                  disabled={!previous}
                  onClick={() => previous && setData(previous)}
                >
                  Restore previous values
                </button>
              </div>
            </form>
            <h3>Score history</h3>
            {history.slice(0, 10).map((h) => (
              <div className="activity" key={h.id}>
                <span>
                  Revision {h.revision} · {h.data.score1} – {h.data.score2}
                </span>
                <small>{date(h.created_at)}</small>
                <button onClick={() => setData(h.data)}>
                  Use these values
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
function SettingsPanel({
  state,
  run,
  busy,
  notify,
}: {
  state: any;
  run: any;
  busy: boolean;
  notify?: (msg: string) => void;
}) {
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    emailSent: boolean;
    inviteUrl: string;
    error?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <Heading
        eyebrow="YOUR WORKSPACE"
        title="Set up for the Club."
        subtitle="Private access for your team. Every pilot user is an administrator."
      />
      <div className="detail-grid">
        <section className="panel">
          <h2>Invite an administrator</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const emailVal = (f.get("email") as string)?.trim();
              if (!emailVal) return;
              setInviting(true);
              setCopied(false);
              try {
                const res = await api("auth/invite", "POST", { email: emailVal });
                setInviteResult({
                  email: emailVal,
                  emailSent: Boolean(res.emailSent),
                  inviteUrl: res.inviteUrl,
                  error: res.error,
                });
                if (res.emailSent) {
                  notify?.(`Invitation email sent to ${emailVal}!`);
                } else {
                  notify?.("Invitation created! Link ready to share.");
                }
                form.reset();
              } catch (err: any) {
                notify?.(err.message || "Failed to create invitation");
              } finally {
                setInviting(false);
              }
            }}
          >
            <label>
              Staff email
              <input
                required
                type="email"
                name="email"
                placeholder="name@example.com"
                disabled={inviting || busy}
              />
            </label>
            <button disabled={inviting || busy} className="primary">
              {inviting ? "Creating invitation…" : "Send invitation"}
            </button>
          </form>
          {inviteResult && (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "rgba(18, 32, 70, 0.5)",
                borderRadius: 8,
                border: "1px solid rgba(197, 160, 89, 0.35)",
              }}
            >
              <p
                style={{
                  margin: "0 0 8px 0",
                  color: inviteResult.emailSent ? "#86efac" : "#fef08a",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {inviteResult.emailSent
                  ? `✓ Invitation email dispatched to ${inviteResult.email}`
                  : `✓ Invitation created for ${inviteResult.email}`}
              </p>
              {!inviteResult.emailSent && (
                <p
                  style={{
                    margin: "0 0 10px 0",
                    fontSize: 13,
                    color: "#cbd5e1",
                    lineHeight: 1.4,
                  }}
                >
                  Email service is awaiting API key configuration. You can copy and send this single-use link directly:
                </p>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  readOnly
                  value={inviteResult.inviteUrl}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    padding: "8px 12px",
                    background: "#070d1e",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 6,
                    color: "#ffffff",
                  }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  className="primary"
                  style={{ padding: "8px 16px", whiteSpace: "nowrap" }}
                  onClick={() => {
                    navigator.clipboard.writeText(inviteResult.inviteUrl);
                    setCopied(true);
                    notify?.("Invite link copied to clipboard!");
                    setTimeout(() => setCopied(false), 3000);
                  }}
                >
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              </div>
            </div>
          )}
          <h3>Organization</h3>
          <dl className="facts">
            <div>
              <dt>Name</dt>
              <dd>Main Venue</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>America/Toronto</dd>
            </div>
            <div>
              <dt>Offline policy</dt>
              <dd>Keep last active content</dd>
            </div>
            <div>
              <dt>Media</dt>
              <dd>Images & slideshows</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2>Your team</h2>
          {state.members.map((m: any) => (
            <div className="activity" key={m.id}>
              <div>
                <strong>{m.name}</strong>
                <p>{m.email}</p>
                <span className="badge">Administrator</span>
              </div>
              {m.id !== state.actor.user_id && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    confirm("Remove this administrator’s access?") &&
                    void run(() => api("members/" + m.id, "DELETE"))
                  }
                >
                  Remove access
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2>Workspace activity</h2>
        {state.history.slice(0, 30).map((h: any) => (
          <div className="activity" key={h.id}>
            <strong>{h.action.replaceAll(".", " · ")}</strong>
            <span>{h.actor_name}</span>
            <small>{date(h.created_at)}</small>
          </div>
        ))}
      </section>
    </>
  );
}
function Publish({
  state,
  close,
  run,
  busy,
  initialContent,
}: {
  state: any;
  close: () => void;
  run: any;
  busy: boolean;
  initialContent?: string;
}) {
  const [content, setContent] = useState(initialContent || ""),
    [selected, setSelected] = useState<string[]>([]),
    [kind, setKind] = useState("normal"),
    [error, setError] = useState(""),
    [disambiguation, setDisambiguation] = useState<
      "reject" | "earlier" | "later"
    >("reject");
  return (
    <Dialog label="Publish content" onClose={close}>
      <button
        className="modal-close"
        onClick={close}
        aria-label="Close publishing dialog"
      >
        <X />
      </button>
      <p className="eyebrow">BRING IT TO YOUR SCREENS</p>
      <h2 id="publish-title">Publish with purpose.</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const [contentType, contentId] = content.split(":");
            const start = f.get("startsAt") as string,
              end = f.get("endsAt") as string;
            const payload = {
              contentType,
              contentId,
              screens: selected,
              kind,
              startsAt: start ? torontoTime(start, disambiguation) : undefined,
              endsAt: end ? torontoTime(end, disambiguation) : null,
            };
            void run(async () => {
              await api("publish", "POST", payload);
              close();
            }, "Content assigned. Watch screen details for render acknowledgement.");
          } catch {
            setError(
              "This Toronto time is invalid or ambiguous. Check the time or select the daylight-saving occurrence.",
            );
          }
        }}
      >
        <label>
          Published content
          <select
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
          >
            <option value="">Choose content…</option>
            <optgroup label="Photos & Videos (Content Library)">
              {state.media.map((m: any) => (
                <option key={m.id} value={"media:" + m.id}>
                  {m.mime_type?.startsWith("video/") ? "🎬 [Video] " : "🖼️ [Photo] "}
                  {m.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Slideshows">
              {state.playlists.map((p: any) => (
                <option key={p.id} value={"playlist:" + p.id}>
                  {p.name} · latest published
                </option>
              ))}
            </optgroup>
            <optgroup label="Design versions">
              {state.versions.map((v: any) => (
                <option key={v.id} value={"design:" + v.id}>
                  {v.name} · v{v.version}
                </option>
              ))}
            </optgroup>
            <optgroup label="Live boards">
              {state.boards.map((b: any) => (
                <option key={b.id} value={"live:" + b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Assignment type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="normal">Publish now · normal content</option>
            <option value="schedule">Scheduled content</option>
            <option value="priority">Priority announcement</option>
            <option value="default">Default / fallback content</option>
          </select>
        </label>
        {kind === "schedule" && (
          <label>
            Starts · Toronto time
            <input name="startsAt" type="datetime-local" required />
          </label>
        )}
        {["schedule", "priority"].includes(kind) && (
          <label>
            Ends · optional
            <input name="endsAt" type="datetime-local" />
          </label>
        )}
        {kind === "schedule" && (
          <label>
            Daylight-saving occurrence
            <select
              value={disambiguation}
              onChange={(e) =>
                setDisambiguation(e.target.value as typeof disambiguation)
              }
            >
              <option value="reject">Reject ambiguous times</option>
              <option value="earlier">Earlier occurrence</option>
              <option value="later">Later occurrence</option>
            </select>
          </label>
        )}
        <fieldset>
          <legend>Choose screens · {selected.length} selected</legend>
          <div className="actions">
            <button
              type="button"
              onClick={() => setSelected(state.screens.map((s: any) => s.id))}
            >
              All screens
            </button>
            <button type="button" onClick={() => setSelected([])}>
              Clear selection
            </button>
          </div>
          {state.groups.map((g: any) => (
            <button
              type="button"
              key={g.id}
              onClick={() =>
                setSelected([...new Set<string>([...selected, ...g.screens])])
              }
            >
              Add {g.name}
            </button>
          ))}
          {state.screens.map((s: any) => (
            <label className="check" key={s.id}>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, s.id]
                      : selected.filter((id) => id !== s.id),
                  )
                }
              />
              {s.name} <small>{s.location}</small>
            </label>
          ))}
        </fieldset>
        <p className="muted">
          Targets:{" "}
          {state.screens
            .filter((s: any) => selected.includes(s.id))
            .map((s: any) => s.name)
            .join(", ") || "None selected"}
          . Group membership is captured now.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || !selected.length || !content}
        >
          {busy
            ? "Publishing…"
            : kind === "schedule"
              ? "Schedule content"
              : "Publish to " +
                selected.length +
                " screen" +
                (selected.length === 1 ? "" : "s")}
        </button>
      </form>
    </Dialog>
  );
}
function ProtectedDisplay({ screenId }: { screenId: string }) {
  const [m, setM] = useState<Manifest | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!screenId) return;
    const load = () =>
      api("screens/" + screenId + "/manifest")
        .then(setM)
        .catch((e) => setError(e.message));
    void load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [screenId]);
  return m ? (
    <Player manifest={m} />
  ) : (
    <div className="empty">{error || "Loading protected preview…"}</div>
  );
}

function QuickCastDialog({
  state,
  close,
  notify,
  reload,
}: {
  state: any;
  close: () => void;
  notify: (msg: string) => void;
  reload: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>(
    state.screens.map((s: any) => s.id)
  );
  const [duration, setDuration] = useState(10);
  const [kind, setKind] = useState<"priority" | "normal">("priority");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [autoExpire, setAutoExpire] = useState("");
  const [fit, setFit] = useState<"cover" | "contain" | "fill">("cover");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  const isPdf =
    file?.name.toLowerCase().endsWith(".pdf") ||
    file?.type === "application/pdf";

  const isVideo =
    file?.type.startsWith("video/") ||
    /\.(mp4|webm|mov)$/i.test(file?.name || "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please choose an image, PDF, or video file to cast.");
      return;
    }
    if (!selected.length) {
      setError("Please select at least one TV screen.");
      return;
    }
    if (scheduleMode === "later" && !startsAt) {
      setError("Please select a scheduled start date and time.");
      return;
    }
    setError("");
    setBusy(true);
    setStatusMsg(
      isVideo
        ? "Uploading video and preparing player…"
        : isPdf
          ? "Extracting PDF pages into high-resolution TV slides…"
          : "Uploading and preparing image…"
    );

    try {
      const uploadFile = isVideo || isPdf ? file : await prepareImageForUpload(file);
      const formData = new FormData();
      formData.append("file", uploadFile);
      if (title.trim()) formData.append("title", title.trim());
      formData.append("screens", JSON.stringify(selected));
      formData.append("duration", duration.toString());
      formData.append("kind", kind);
      formData.append("scheduleMode", scheduleMode);
      formData.append("fit", fit);
      if (scheduleMode === "later" && startsAt) formData.append("startsAt", startsAt);
      if (endsAt) formData.append("endsAt", endsAt);
      if (autoExpire) formData.append("autoExpire", autoExpire);

      const res = await fetch("/api/v1/quick-cast", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to quick cast.");

      if (data.scheduled) {
        notify(
          `📅 Scheduled post for ${new Date(data.startsAt).toLocaleString("en-CA", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })} across ${data.screensCount} screen(s)!`
        );
      } else if (data.endsAt) {
        notify(
          `⚡️ Cast live to ${data.screensCount} screen(s)! Auto-expires at ${new Date(data.endsAt).toLocaleTimeString("en-CA", {
            hour: "numeric",
            minute: "2-digit",
          })}.`
        );
      } else {
        notify(
          isVideo
            ? `🎬 Cast video live to ${data.screensCount} screen(s)! Playing now.`
            : isPdf
              ? `⚡️ Cast ${data.pagesCount} slides from PDF to ${data.screensCount} screen(s)! Refreshing TV now.`
              : `⚡️ Cast image live to ${data.screensCount} screen(s)! Refreshing TV now.`
        );
      }
      await reload();
      close();
    } catch (err: any) {
      setError(err.message || "Failed to cast file.");
    } finally {
      setBusy(false);
      setStatusMsg("");
    }
  }

  return (
    <Dialog label="Quick Cast to TV" onClose={close}>
      <div className="dialog-heading">
        <button
          className="dialog-close"
          aria-label="Close Quick Cast dialog"
          onClick={close}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">⚡️ 1-TAP INSTANT DISPLAY & SCHEDULING</span>
        <h2>Quick Cast to TV</h2>
        <p>
          Send photos, videos, event flyers, or PDF documents straight to your
          screens or schedule them for future dates.
        </p>
      </div>
      <form className="stack dialog-body" onSubmit={handleSubmit}>
        <div className="quick-cast-dropzone">
          <label className="upload-zone" style={{ minHeight: "130px", cursor: "pointer" }}>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm,video/quicktime"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  if (!title) setTitle(f.name.replace(/\.[^/.]+$/, ""));
                }
              }}
            />
            {file ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontWeight: 600, fontSize: "16px", marginBottom: "4px" }}>
                  {isVideo
                    ? "🎬 Video Clip (MP4/WebM/MOV)"
                    : isPdf
                      ? "📄 PDF Document"
                      : "🖼️ Image File"}
                </p>
                <p style={{ color: "var(--navy)", fontWeight: "bold" }}>{file.name}</p>
                <small style={{ color: "#666" }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB · Click to choose a different file
                </small>
                {isVideo && (
                  <p
                    className="badge"
                    style={{
                      marginTop: "8px",
                      background: "#fef3c7",
                      color: "#92400e",
                      display: "inline-block",
                    }}
                  >
                    Hardware-accelerated TV playback (Audio muted by default for signage)
                  </p>
                )}
                {isPdf && (
                  <p
                    className="badge"
                    style={{
                      marginTop: "8px",
                      background: "#e8effc",
                      color: "var(--navy)",
                      display: "inline-block",
                    }}
                  >
                    Multi-page PDF will auto-create a timed rotating slideshow
                  </p>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                <Zap size={32} style={{ color: "var(--gold-dark)", marginBottom: "6px" }} />
                <p style={{ fontWeight: 600, fontSize: "15px" }}>
                  Choose a Photo, Video, or PDF
                </p>
                <small>MP4, WebM, MOV, PNG, JPEG, or multi-page PDF up to 150 MB</small>
              </div>
            )}
          </label>
        </div>

        <label>
          Title (optional)
          <input
            placeholder="e.g. Weekend Tournament Highlights or Dinner Menu"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {isPdf && (
          <label>
            Seconds per page (slideshow rotation)
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <option value="5">5 seconds</option>
              <option value="8">8 seconds</option>
              <option value="10">10 seconds (Recommended)</option>
              <option value="15">15 seconds</option>
              <option value="20">20 seconds</option>
              <option value="30">30 seconds</option>
            </select>
          </label>
        )}

        <label>
          Screen Fit & Aspect Ratio
          <select
            value={fit}
            onChange={(e) => setFit(e.target.value as any)}
          >
            <option value="cover">Fill Screen Edge-to-Edge (Cover - Recommended, no black bars)</option>
            <option value="contain">Fit Entire Image / PDF (Contain - Letterbox/pillarbox if ratio differs)</option>
            <option value="fill">Stretch to Fill Screen (16:9)</option>
          </select>
        </label>

        {/* Timing & Scheduling Section */}
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "14px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--navy)",
              display: "block",
              marginBottom: "10px",
            }}
          >
            ⏱️ Display Timing & Schedule
          </span>
          <div style={{ display: "flex", gap: "18px", marginBottom: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="radio"
                name="scheduleMode"
                checked={scheduleMode === "now"}
                onChange={() => setScheduleMode("now")}
              />
              <strong>⚡️ Cast Immediately</strong>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="radio"
                name="scheduleMode"
                checked={scheduleMode === "later"}
                onChange={() => setScheduleMode("later")}
              />
              <strong>📅 Schedule for Later</strong>
            </label>
          </div>

          {scheduleMode === "later" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label>
                Starts At (Toronto time) *
                <input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </label>
              <label>
                Ends At (Optional auto-expire)
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <div>
              <label>
                Auto-expire / Remove post
                <select
                  value={autoExpire}
                  onChange={(e) => setAutoExpire(e.target.value)}
                >
                  <option value="">Keep displaying until manually changed</option>
                  <option value="1">Auto-remove in 1 hour</option>
                  <option value="2">Auto-remove in 2 hours</option>
                  <option value="4">Auto-remove in 4 hours</option>
                  <option value="8">Auto-remove in 8 hours</option>
                  <option value="today">Auto-remove at midnight tonight</option>
                  <option value="custom">Choose custom expiration date/time…</option>
                </select>
              </label>
              {autoExpire === "custom" && (
                <label style={{ marginTop: "8px" }}>
                  Expiration Date & Time
                  <input
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {scheduleMode === "now" && (
          <label>
            Display mode
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "priority" | "normal")}
            >
              <option value="priority">
                ⚡️ Instant Takeover (Show immediately over current content)
              </option>
              <option value="normal">
                Normal Display (Standard content assignment)
              </option>
            </select>
          </label>
        )}

        <fieldset>
          <legend>Select TV Screens · {selected.length} selected</legend>
          <div className="actions" style={{ marginBottom: "8px" }}>
            <button
              type="button"
              onClick={() => setSelected(state.screens.map((s: any) => s.id))}
            >
              All screens
            </button>
            <button type="button" onClick={() => setSelected([])}>
              Clear selection
            </button>
          </div>
          {state.screens.map((s: any) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, s.id]
                      : selected.filter((id) => id !== s.id)
                  )
                }
              />
              <strong>{s.name}</strong> <small>({s.location || s.orientation})</small>
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {statusMsg && (
          <p
            className="badge"
            style={{
              background: "#fef3c7",
              color: "#92400e",
              textAlign: "center",
              display: "block",
              padding: "10px",
            }}
          >
            {statusMsg}
          </p>
        )}

        <button
          type="submit"
          className="primary"
          disabled={busy || !file || !selected.length}
          style={{ padding: "14px", fontSize: "16px", fontWeight: 600 }}
        >
          {busy
            ? "Preparing & Casting to TV…"
            : scheduleMode === "later"
              ? `📅 Schedule ${isVideo ? "Video" : isPdf ? "PDF" : "Post"} for ${selected.length} Screen${selected.length === 1 ? "" : "s"}`
              : `⚡️ Cast ${isVideo ? "Video" : isPdf ? "PDF" : "Image"} to ${selected.length} Screen${selected.length === 1 ? "" : "s"}`}
        </button>
      </form>
    </Dialog>
  );
}

