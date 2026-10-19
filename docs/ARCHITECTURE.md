# Architecture decisions

## Repository discovery

The parent repository contains independent MemberHub (Next.js/React, CSS Modules, Neon/Drizzle), MobileApp (Vite/Capacitor), Sailtide and PicTide applications. PicTide's current backend uses Cloudflare Worker/D1/R2 despite older root documentation describing Firebase. MemberHub already has MailerSend and object-storage integration conventions. Existing local website/mobile edits were present before signage work and are outside this implementation.

MemberHub/AGENTS.md requires reading installed Next.js documentation. The signage workspace has its own Next-generated instruction file and follows its installed version's route-handler/client-component conventions.

## ADR 001 — Isolated application inside the existing repository

Use a standalone npm package and Android Gradle project under The OC TV App. Do not change the root workspace, public-site routes, existing database or deployment project. This permits separate releases and eventual extraction into its own repository without migrating the public website.

## ADR 002 — Authoritative source brand

The live website source, not the slightly different brand-kit palette, determines visual tokens. Source: MemberHub/src/app/globals.css, layout.tsx, page.module.css, site-header and public/brand/brand-source. Reuse the official crest and existing tennis/waterfront photography. Tokens live in src/shared/brand.css. Cormorant Garamond and Plus Jakarta Sans are bundled locally with their licenses.

The dashboard uses accessible form controls and high-contrast navy actions. TV templates use the same typography and palette. Shared token/renderer code is inside the signage workspace; the public website does not import it.

## ADR 003 — Database and storage

Use separate PostgreSQL/Neon resources. Parameterized SQL transactions implement pairing, publication, schedule locking and optimistic revisions. The Drizzle node-postgres adapter is available for typed extensions; reviewed SQL migrations are the authoritative schema and are applied transactionally with checksums and an advisory migration lock.

Use a private R2 bucket through the S3 SDK, matching infrastructure already present in the repository. Temporary signed uploads land in quarantine. Finalization enforces size and decoded pixel limits, normalizes image data through Sharp and writes immutable random keys plus thumbnails. SVG is rasterized, never served as user-authored executable markup. Configure quarantine lifecycle cleanup separately.

Local filesystem storage is explicitly development-only. Production never falls back to local files or demo data. Secrets remain server-side.

## ADR 004 — React Konva and a single renderer

React Konva was selected over Fabric.js because editor and viewer share React components and rendering state without a second imperative scene model. The serializable schema is application-owned, not a library serialization format. Editor selection handles and guides are excluded from exact preview.

The receiver build imports the same CanvasRenderer and DisplayPlayer modules. It bundles code, fonts, crest and fallback in the APK. Android WebViewAssetLoader serves trusted local assets. Android networking owns credentials, assignment retrieval and downloads; JavaScript receives only the manifest and local asset URLs.

Schema and renderer protocol are version 1. A receiver rejects unsupported versions and retains valid content. Changing rendering semantics requires a version bump and a coordinated APK rollout. Old published versions remain immutable.

## ADR 005 — Polling for the small pilot

Two-second foreground polling, one-second polling for a live board, avoids another realtime provider or beta WebSocket dependency. Every response resolves authoritative database state. Polls do not create heartbeat rows; heartbeats are separate at 30 seconds. Offline status begins after 90 seconds. Error backoff caps at 30 seconds and healthy communication restores the normal interval.

At three 24/7 screens, two-second polling is approximately 3.9 million requests/month before live mode. Verify cost and database capacity before production; revisit managed realtime when scaling. Version/ETag support exists on the device sync endpoint. Scheduling is evaluated at request time so minute-level cron granularity is not on the display-delivery path.

## ADR 006 — Authentication and device security

Staff sessions use random opaque tokens stored hashed in PostgreSQL and secure host-only cookies in production. Passwords use bcrypt with an explicit 72-byte maximum. Every staff mutation checks request origin and organization membership. All pilot staff are admins; no public registration.

Account links and pairing claims are transactional, expiring and single-use. A pairing code is not a device credential: the installation independently holds a high-entropy challenge and device token. The token is activated only after an authenticated administrator claims the code. Concurrent claims lock the same pairing row.

Device credentials are scoped to one screen and stored with Android Keystore-backed encryption. Hardware replacement preserves logical screen identity and assignments while revoking prior credentials. Cached content can persist offline until revocation becomes reachable; this is consistent with the selected offline policy.

The display URL contains no bearer secret. Web display previews require a staff session. Native playback uses the bundled renderer and device APIs. Native message listeners accept only the trusted local origin/main frame; external navigation is blocked.

## ADR 007 — Operational truth

An assignment means intended content, not proof of display. A render acknowledgement is emitted after fonts/assets are ready and a frame has drawn; the server checks assignment/content/version/item identity before recording it. Acknowledgements cannot prove that a physical panel is switched on.

Keep structured errors, request IDs, versioned acknowledgements and publishing/live-score history. Raw heartbeat samples retain seven days; screen state holds the latest heartbeat. Tokens, passwords and signed URLs must not be logged.
