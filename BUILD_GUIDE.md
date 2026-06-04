# Washflow — Desktop & Mobile Build Guide
### Windows EXE + Android APK + iOS IPA
**Prepared by Aumsoft Technology (Pty) Ltd**

---

## What Was Added to Your Project

| File | Purpose |
|---|---|
| `electron/main.js` | Electron main process — creates the native window |
| `electron/preload.js` | Secure bridge between Electron and your React app |
| `electron-builder.yml` | Windows installer configuration |
| `capacitor.config.ts` | Updated — now uses bundled assets (offline-first) |
| `package.json` | Updated — added Electron, electron-builder, and all build scripts |
| `LICENSE.txt` | Required by electron-builder for the installer |

---

## Prerequisites — Install These First

### 1. Node.js (v20 or later)
Download from: https://nodejs.org/en/download
- Choose the **LTS** version
- Verify: open a terminal and run `node --version`

### 2. Git
Download from: https://git-scm.com/download/win

### 3. For Android only — Android Studio
Download from: https://developer.android.com/studio
- During setup, install the **Android SDK** and **Android Virtual Device (AVD)**
- Set the `ANDROID_HOME` environment variable to your SDK path
  - Usually: `C:\Users\YourName\AppData\Local\Android\Sdk`

### 4. For iOS only — Mac required
- iOS builds **must** be done on a Mac
- Install **Xcode** from the Mac App Store
- Run: `sudo xcode-select --install`

---

## Step 1 — Set Up the Project

Open a terminal (Command Prompt or PowerShell on Windows), navigate to your project folder, and run:

```bash
# Clone the repo (if not already done)
git clone https://github.com/BebbaApp/washflow-saas.git
cd washflow-saas

# Install all dependencies (including Electron and electron-builder)
npm install
```

---

## Step 2 — Windows EXE Installer

### Build the installer

```bash
npm run electron:build:win
```

This command does three things automatically:
1. Builds your React app (`vite build` → creates `dist/` folder)
2. Packages everything with Electron
3. Creates a Windows installer in `dist-electron/`

### Output

```
dist-electron/
  Washflow-Setup-1.0.0.exe   ← The installer (share this file)
```

### Test without building the installer first

```bash
# Build the web app first
npm run build

# Then launch the Electron desktop app in dev mode
npm run electron:dev
```

> **Note:** The first `electron:build:win` may take 5–10 minutes as it downloads the Electron binary.

---

## Step 3 — Android APK

### One-time setup (first time only)

```bash
# Add the Android platform to your project
npx cap add android
```

### Build and open in Android Studio

```bash
npm run cap:android
```

This will:
1. Build your React app
2. Sync the assets into the Android project
3. Open Android Studio automatically

### Inside Android Studio

1. Wait for Gradle sync to finish (bottom status bar)
2. Connect a physical Android phone via USB **OR** start an emulator (AVD Manager)
3. Click the **Run ▶** button to install and launch the app
4. To build a release APK: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

The APK will be at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Change the App ID (important before publishing)

The app ID is set in `capacitor.config.ts` as `com.aumsoft.washflow`. To change it:
1. Edit `capacitor.config.ts`
2. Run `npx cap sync android` again

---

## Step 4 — iOS IPA (Mac only)

### One-time setup (first time only)

```bash
# Add the iOS platform
npx cap add ios
```

### Build and open in Xcode

```bash
npm run cap:ios
```

This will:
1. Build your React app
2. Sync assets into the iOS project
3. Open Xcode automatically

### Inside Xcode

1. Select your development team under **Signing & Capabilities**
2. Connect an iPhone via USB **OR** select a simulator
3. Click **Run ▶** to install the app
4. To build for App Store: **Product → Archive**

---

## Step 5 — Sync After Any Code Changes

Whenever you update your React code and want to push the changes to Android or iOS:

```bash
npm run cap:sync
```

This rebuilds the web app and copies the new assets to both native projects.

---

## All Available Build Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start local web dev server (browser) |
| `npm run build` | Build the React web app only |
| `npm run electron:dev` | Launch the desktop Electron app (dev mode) |
| `npm run electron:build:win` | Build Windows `.exe` installer |
| `npm run electron:build:mac` | Build macOS `.dmg` (on Mac only) |
| `npm run electron:build:linux` | Build Linux `.AppImage` |
| `npm run cap:android` | Build + open Android project in Android Studio |
| `npm run cap:ios` | Build + open iOS project in Xcode |
| `npm run cap:sync` | Sync latest web build to both Android and iOS |

---

## Online vs Offline Behaviour

| Feature | Needs Internet? |
|---|---|
| App UI, navigation, forms | ❌ No — fully bundled |
| Supabase database reads/writes | ✅ Yes |
| User authentication (login) | ✅ Yes |
| Real-time updates | ✅ Yes |

The app shell loads instantly without internet. Supabase calls will fail gracefully when offline.

---

## Troubleshooting

### `electron` not found
```bash
npm install electron electron-builder --save-dev
```

### Android Gradle sync fails
- Make sure `ANDROID_HOME` is set correctly
- In Android Studio: **File → Sync Project with Gradle Files**

### iOS signing error
- In Xcode, go to **Signing & Capabilities** and select your Apple Developer account
- Free accounts can sideload to personal devices; App Store publishing requires a paid account ($99/year)

### White screen on Electron launch
- Make sure you ran `npm run build` before `npm run electron:dev`
- Check the DevTools console (will open automatically in dev mode)

---

## App Details

| Setting | Value |
|---|---|
| App ID | `com.aumsoft.washflow` |
| App Name | `Washflow` |
| Publisher | `Aumsoft Technology (Pty) Ltd` |
| Version | `1.0.0` |

---

*Aumsoft Technology (Pty) Ltd — info@aumsoft.co.za — www.aumsoft.co.za*
