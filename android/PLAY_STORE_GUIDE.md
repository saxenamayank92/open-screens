# Google Play Store Publishing Guide (Android TV)

This document outlines everything needed to publish the **OpenScreens** app to the Google Play Store for Android TV.

---

## 1. Pre-generated Assets (Ready in `android/play-store-assets/`)

| Asset | Size | Purpose | Location |
| :--- | :--- | :--- | :--- |
| **App Icon** | 512 x 512 PNG | Main Store Listing Icon | `android/play-store-assets/app_icon_512.png` |
| **Feature Graphic** | 1024 x 500 PNG | Play Store Banner | `android/play-store-assets/feature_graphic_1024x500.png` |
| **TV Banner** | 320 x 180 PNG | Android TV Launcher Tile | `android/app/src/main/res/drawable-xhdpi/tv_banner.png` |
| **TV Screenshots** | 1920 x 1080 PNG | Store Listing Previews | `android/play-store-assets/tv_screenshot_1.png`<br>`android/play-store-assets/tv_screenshot_2.png` |

---

## 2. Generate Official Keystore & Build Release Bundle (.aab)

Google Play requires an **Android App Bundle (`.aab`)** signed with an official release key (not debug).

### Step A: Generate your official release key (Run once)
```bash
./android/create-release-keystore.sh ~/openscreens.keystore
```
*(Save the password you choose safely in a password manager)*

### Step B: Build the signed `.aab` for Google Play
```bash
export SCREENS_KEYSTORE="$HOME/openscreens.keystore"
export SCREENS_STORE_PASSWORD="<your-password>"
export SCREENS_KEY_ALIAS="screens"
export SCREENS_KEY_PASSWORD="<your-password>"

cd android
./gradlew bundleProductionRelease
```
The output file ready for upload to Google Play Console:
```
android/app/build/outputs/bundle/productionRelease/app-production-release.aab
```

---

## 3. Google Play Console Steps

1. Go to [play.google.com/console](https://play.google.com/console) and select your Developer Account.
2. Click **Create app**:
   - **App name**: OpenScreens
   - **Default language**: English (Canada / US)
   - **App or game**: App
   - **Free or paid**: Free
3. **Android TV Form Factor**:
   - In the left sidebar, navigate to **Release > Advanced settings > Form factors**.
   - Click **Add form factor** and select **Android TV**.
4. **Store Listing**:
   - Short description: `Digital display and screen receiver for your venue or organization.`
   - Full description: `Official digital signage and display receiver for your venue or organization. Seamlessly displays club announcements, schedules, tournament draws, weather, and dining updates across club screens.`
   - Upload the assets from `android/play-store-assets/`.
5. **App Content & Policies**:
   - **Privacy Policy URL**: `https://screens.example.com/privacy` (or `https://example.com/privacy`)
   - **Ads**: Select "No, my app does not contain ads".
   - **App access**: Provide login test instructions or pairing test code for reviewers.
6. **Upload Release**:
   - In **Release > Production (or Internal Testing)**, upload `app-production-release.aab`.
   - Submit for review!

---

## 4. Current Sideloading (Immediate use on any TV)

For immediate installation on any Android TV without waiting for Google Play review:
- **Direct TV Download**: Open the **Downloader** app on any Android TV and navigate to:
  ```
  https://screens.example.com/tv.apk
  ```
- **Via ADB**:
  ```bash
  adb connect <TV_IP>:5555
  adb install android/app/build/outputs/apk/production/release/OpenScreens-TV.apk
  ```
- **Via USB Drive**: Copy `OpenScreens-TV.apk` to a USB flash drive and plug it directly into the TV.
