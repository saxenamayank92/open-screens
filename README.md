# 📺 OpenScreens

> **Production-grade, open-source digital signage platform and offline-first Android TV display receiver.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![Android TV](https://img.shields.io/badge/Android%20TV-API%2026+-green)](https://developer.android.com/tv)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17+-blue)](https://www.postgresql.org/)

---

## 💡 Why OpenScreens?

Commercial digital signage platforms (Rise Vision, Raydiant, Yodeck) charge **$30–$80/screen every single month** for sluggish web wrappers. When venue Wi-Fi stutters or drops, displays show ugly browser 404 errors or spin indefinitely.

**OpenScreens** was built from the ground up to solve this:
1. **Offline-First Resilience:** The native Android TV receiver caches slides, media, and fonts locally. If the internet drops completely, the TV keeps playing seamlessly.
2. **Next.js 16 Control Studio:** Full drag-and-drop designer, multi-screen playlist scheduling, and live overlay controls (announcements, sports scores, alerts).
3. **Hardware Agnostic:** Runs on affordable Android TV sticks (Chromecast, Fire TV, Onn 4K) or smart TVs.
4. **100% Open Source:** Self-host on your own servers or cloud infrastructure. Zero subscription fees.

---

## 🏗️ Architecture

```
                       ┌────────────────────────────────────────┐
                       │          OpenScreens Studio            │
                       │     (Next.js 16 + React 19 + TS)       │
                       └───────────────────┬────────────────────┘
                                           │
                        REST API + Push    │  PostgreSQL (Neon / Self-hosted)
                                           ▼  Cloudflare R2 / S3 Storage
                       ┌────────────────────────────────────────┐
                       │          Control & Media API           │
                       └───────────────────┬────────────────────┘
                                           │
                         Pairing & Sync    │  Local offline caching
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Android TV Display Receiver (Kotlin)                      │
│   • Local SQLite Cache     • Native WebView Asset Loader   • Offline Playback│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

- **🎨 Visual Studio:** Create broadcasts, schedules, partner shoutouts, and announcements with precision canvas tools.
- **📱 4-Digit TV Pairing:** Turn on any TV running the OpenScreens app, enter the 4-digit code in Studio, and the screen is instantly linked.
- **⚡ Live Controls:** Push breaking updates, manual sports scoring, or emergency alerts immediately to screens without rebuilding playlists.
- **🔄 Local Offline Renderer:** Assets, fonts, and layouts are mirrored to the Android device. Runs 24/7 without persistent internet connectivity.
- **🌓 Portrait & Landscape Support:** Native support for 16:9 landscape monitors and vertical 9:16 portrait kiosk totems.
- **🔒 Enterprise Security:** Single-use cryptographic invite links, role-based access, and CSRF protection.

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 22+
- PostgreSQL 17+
- (Optional for Android TV development) Java 21 & Android SDK 36

### 1. Clone & Install
```bash
git clone https://github.com/saxenamayank92/open-screens.git
cd open-screens
npm ci
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```
Edit `.env.local` to point to your PostgreSQL instance:
```env
DATABASE_URL=postgresql://localhost:5432/openscreens
APP_URL=http://localhost:3100
LOCAL_MEDIA_DIR=.local/media
LOCAL_EMAIL=true
```

### 3. Run Migrations & Bootstrap Admin
```bash
npm run db:migrate
npm run admin:bootstrap -- admin@example.com
```
*Note: In local development with `LOCAL_EMAIL=true`, the invite link will be written to `.local/mail/`.*

### 4. Start the Studio
```bash
npm run dev
```
Open **[http://localhost:3100](http://localhost:3100)** in your browser.

---

## 📺 Building the Android TV App

The Android TV client lives in the `android/` directory.

### Build the Local Offline Renderer First:
```bash
npm run renderer:build
```

### Assemble the Debug APK:
```bash
cd android
./gradlew assembleLocalDebug -PscreensBaseUrl=http://YOUR_LOCAL_IP:3100
```
The output APK is generated at:
`android/app/build/outputs/apk/local/debug/app-local-debug.apk`

Install it on any connected Android TV or emulator via ADB:
```bash
adb install android/app/build/outputs/apk/local/debug/app-local-debug.apk
```

---

## 🧪 Quality & Tests

Run all unit, integration, and E2E test suites:

```bash
# Typecheck
npm run typecheck

# Unit tests (Vitest)
npm test

# E2E tests (Playwright)
npm run test:e2e

# Android unit tests
cd android && ./gradlew testLocalDebugUnitTest
```

---

## 📄 License

OpenScreens is licensed under the [MIT License](LICENSE). Built and maintained by [Mayank Saxena](https://github.com/saxenamayank92) / [xTide Apps](https://www.xtideapps.com).
