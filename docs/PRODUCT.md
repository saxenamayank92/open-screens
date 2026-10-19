# Pilot specification

**Product:** OpenScreens. **Intended origin:** https://screens.example.com.

Initial audience: invited club administrators operating 2–3 TVs. TCL Google TV is the first intended physical test device; other installable Android TV/Google TV devices require compatibility testing. Cast-only Chromecast is not supported.

## Included

- Authenticated studio, content library, screens, screen details, groups, schedule, live controls, pairing and staff settings.
- Five starter templates: tournament welcome, general announcement, sponsor advertisement, fullscreen image and live tennis scoreboard.
- Editable versioned JSON documents, portrait 1080×1920 and landscape 1920×1080, brand fonts, text, images, QR codes, shapes, clock/date, layer order, position, size, rotation, duplication, undo/redo and safe guides.
- Immutable published design and playlist snapshots. Draft changes never change already-published versions.
- Manual player/team names, court, game/set scores, serving, status and next match; explicit score saving with stale-write prevention and audit history.
- Images and looping slideshows, configurable durations and a 400 ms crossfade. Default duration is 10 seconds.
- Immediate, future, fallback and temporary priority publishing. Selected groups are expanded and deduplicated at publication time.
- Device identity without staff passwords, single-use pairing, heartbeats, render acknowledgements, refresh, orientation, hardware replacement and revocation.
- Last valid offline playback and cache persistence across restarts.

## Rules

Organization timezone is America/Toronto. Priority > scheduled > normal > default > bundled fallback. Equal-priority announcements resolve by activation time, creation time and stable ID. Explicit schedule overlaps are rejected under a per-screen transaction lock. DST gaps are rejected; ambiguous repeated times require a selected occurrence.

During internet loss, the last active assignment remains active, including announcements that would otherwise expire. Cached slideshows keep looping. On reconnection, authoritative cloud state wins. A remote revocation cannot reach a device while it is offline.

All pilot staff are administrators. The schema preserves organization membership and a role boundary, but editor-facing policy/UI is deferred.

## Acceptance targets

- Pairing completes without staff login on the TV and cannot be claimed twice.
- Normal cached updates target two seconds and must be measured within five seconds on the pilot network.
- Dashboard intent, acknowledged revision, last heartbeat and errors are distinguishable.
- No network/browser error pages appear during offline playback.
- Both portrait transforms fill the correct rotated output; mismatched canvas aspect ratios fit without cropping or stretching.
- Manual reopening after full power restart is acceptable where consumer TV firmware blocks automatic foreground launch.

Production readiness additionally requires configured cloud resources, backup/restore validation, real email delivery, physical TCL checks and the 24-hour soak in the acceptance checklist.
