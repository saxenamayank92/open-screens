# Deployment and operations

## Environment boundaries

Local: dedicated PostgreSQL and local media/email capture. Preview/staging: separate Neon database, R2 bucket and MailerSend credentials/sender. Production: separate resources again. Never attach the public website's database or bucket.

Required server variables: `DATABASE_URL`, `APP_URL`, `MAILERSEND_API_KEY`, `MAILERSEND_SENDER_EMAIL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. `MAILERSEND_SENDER_NAME` is optional. `LOCAL_MEDIA_DIR` and `LOCAL_EMAIL` are disabled by production runtime checks. Use `.env.example`; real values belong in ignored local files or the deployment environment.

The local operator bootstrap takes an explicit email and sends a single-use invitation. Do not pass passwords in shell arguments. Password reset invalidates existing sessions. Production emails require MailerSend sender verification; do not represent API acceptance as inbox delivery.

## Vercel preparation — no automatic production deployment

1. Create a dedicated Vercel project with Root Directory `The OC TV App`, Next.js framework, `npm ci` install and `npm run build` build command.
2. Configure environment-scoped credentials and canonical APP_URL. Preview builds must never receive production credentials.
3. Provision a separate Neon database and private R2 bucket. Restrict R2 credentials to that bucket. Configure CORS only for authorized application origins, PUT/GET/HEAD and required headers. Add one-day deletion for `quarantine/` objects.
4. Apply reviewed migrations using the target environment's credentials. Keep migration execution separate from ordinary application builds. Bootstrap the explicit initial administrator.
5. Validate a staging deployment, authenticated upload/download, invitation acceptance, password recovery and receiver pairing before production.
6. **Only with explicit approval**, attach `screens.example.com`. Use the exact DNS target Vercel supplies; do not guess or overwrite the public website's records. Verify HTTPS and the custom origin after deployment.

No cloud resources or DNS records are provisioned by this repository's build commands.

## Android builds and installation

`local` defaults to emulator host `http://10.0.2.2:3100`, accepts `-PscreensBaseUrl`, and permits cleartext for development only. `staging` accepts an HTTPS `-PscreensBaseUrl` and defaults to an intentionally invalid host. `production` uses the intended production origin. Local/staging application IDs have suffixes and cannot overwrite production.

```sh
npm run renderer:build
cd android
./gradlew assembleLocalDebug
./gradlew assembleStagingRelease -PscreensBaseUrl=https://YOUR-STAGING-ORIGIN
./gradlew assembleProductionRelease
```

Release signing uses `SCREENS_KEYSTORE`, `SCREENS_STORE_PASSWORD`, `SCREENS_KEY_ALIAS` and `SCREENS_KEY_PASSWORD`. Without signing configuration, release artifacts are unsigned and are not installation-ready. Store signing material outside the repository; back it up securely. Preserve the key and application ID for upgrades.

Sideload an approved signed APK using Android's supported installation/developer tooling. No remote is needed during normal paired playback. Press Back five times quickly to open the PIN-protected local reset dialog. Full consumer-TV boot autolaunch is not claimed or implemented through unsupported workarounds; reopen the app after a restart where required.

## Blank or stale TV diagnosis

1. Compare intended assignment and last acknowledged revision in screen details.
2. Check heartbeat age, app version, resolution and reported errors.
3. Check media download/storage access; an unavailable candidate must not replace valid cached content.
4. Queue remote refresh. It is delivered on the next successful device sync.
5. If the device remains offline, inspect its internet access and open the receiver locally.
6. Revoke and pair replacement hardware against the existing logical screen when necessary.

Publishing and scores are audited. A device showing cached content may differ from the current cloud preview during an outage. Acknowledgements are renderer evidence, not physical-panel screenshots.

## Backup, rollback and upkeep

Enable Neon point-in-time recovery appropriate to the deployment plan and retain independent encrypted logical backups. Back up R2 objects and PostgreSQL together: published versions reference immutable asset IDs. Rehearse restoration into an isolated staging environment before launch.

Roll back application deployments independently of data. Migrations are checksum-verified and forward-only; create corrective migrations instead of modifying applied files. Preserve old renderer/schema compatibility until all TVs have been upgraded. A schema-incompatible assignment is rejected by the receiver.

Monitor server errors, pairing failures, heartbeat age, render acknowledgements, media errors and cost. No external alerting destination is configured automatically. Raw device-heartbeat retention is seven days; audit/publication history is preserved. Quarantine cleanup is an R2 lifecycle prerequisite. Keep database/storage access least-privileged and rotate revoked staff/device access through the application.
