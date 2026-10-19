# Physical Android TV pilot acceptance

Record TV make/model, Android/Google TV version, WebView version, app version, screen resolution, orientation, network and APK signing identity with each run. No physical TCL verification is implied by a successful Gradle build.

- [ ] Install signed APK; launcher icon/banner visible; no touchscreen required.
- [ ] Fresh installation shows branded pairing code and correct environment URL.
- [ ] Expired code is rejected; new code appears; competing claims cannot pair twice.
- [ ] Pair without staff password on TV; assign name, location and six-digit reset PIN.
- [ ] Pairing completes and default branded content appears; heartbeat visible in dashboard.
- [ ] Landscape output fits correctly; test a matching landscape design.
- [ ] Portrait clockwise rotates the full output correctly on a physically rotated TV.
- [ ] Portrait counterclockwise rotates correctly; crest/text remain proportional.
- [ ] Mismatched canvas fits without cropping/stretching; safe margins remain visible.
- [ ] Publish image/design; measure click-to-visible and acknowledgement latency over 20 changes.
- [ ] Verify actual fonts, QR readability, photography and score layout against browser preview.
- [ ] Slideshow uses chosen durations and crossfades without blank frames; next image is preloaded.
- [ ] Missing/corrupt media is reported and skipped without replacing valid cached playback.
- [ ] Enter player/court names and scores on a phone; save and verify TV update; test correction.
- [ ] Priority override and schedule transitions work; cancellation restores underlying assignment.
- [ ] Disconnect internet; content remains and cached slideshow loops; dashboard becomes offline.
- [ ] Let a scheduled/priority end time pass offline: last active content intentionally remains.
- [ ] Restart the app while offline; cached content and fonts still render.
- [ ] Restore internet; newest authoritative assignment appears and heartbeat/ack recover.
- [ ] Restart television; record manufacturer behaviour and manual reopening requirement.
- [ ] Remote refresh recovers the renderer without re-pairing.
- [ ] Five Back presses open reset; incorrect PIN fails; correct PIN clears local data.
- [ ] Revoke online device; it stops playback and returns to pairing. Offline revocation takes effect after reconnection.
- [ ] Replace hardware using the existing logical screen; old token fails and assignments remain.
- [ ] Upgrade with same signing key; device identity, cache and assignments survive.
- [ ] Run a 24-hour mixed design/slideshow/live-board soak; inspect memory, errors and stale frames.

Video is excluded from this pilot. Video uploads must be rejected rather than implying playback support. Repeat relevant checks on Chromecast with Google TV, Google TV Streamer, Shield or other Android TV hardware before claiming compatibility.
