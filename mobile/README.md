# Cattery Tracker — Mobile & Tablet

Expo SDK 57 + React Native 0.86 + expo-router. One codebase for phone and
tablet, with native push through EAS.

## Quick start (development build)

```bash
npm install
cp .env.example .env        # set EXPO_PUBLIC_API_URL, and EAS_PROJECT_ID after `eas init`
npx expo start
```

### Pointing the app at the backend

`localhost` means different machines depending on where the app runs, which is
the usual reason "the backend is up but the app cannot reach it".

| Running on | Host that reaches the API | Set `EXPO_PUBLIC_API_URL` to |
| --- | --- | --- |
| Android emulator | `10.0.2.2` (the AVD's alias for the host) | `http://localhost:8000` — rewritten automatically |
| iOS simulator | `localhost` (shares the host network) | `http://localhost:8000` |
| Web | `localhost` | `http://localhost:8000` |
| Physical device | your machine's LAN address | `http://192.168.x.x:8000` |

`resolveApiUrl()` in `src/lib/api.ts` rewrites a loopback host to `10.0.2.2`
when it detects the Android emulator (`Platform.OS === "android"` and
`Device.isDevice === false`), so one `.env` covers the first three rows and does
not go stale when your LAN address changes. A physical device is left alone,
because only a real address works there.

Start the backend with `--host 0.0.0.0` so it accepts connections from the
emulator or a device, not just from the host, and make sure your origin is in
the backend's `CORS_ORIGINS` if you preview in a browser.

```bash
npm run typecheck    # tsc --noEmit
npm run doctor       # expo-doctor: config and dependency checks
npx expo export --platform ios      # verify the bundle builds
```

## Push notifications need a real build, not Expo Go

This is the part that catches people out:

- **Android** — Expo Go dropped remote push in SDK 53. It cannot receive one.
- **iOS** — Expo Go can show a notification, but the token it hands out belongs
  to Expo's own project, so *our* backend cannot target it.

So `getExpoPushTokenAsync` is called with our own EAS `projectId`, and the app
must be a development build or an EAS build.

### Previewing in Expo Go

`expo-notifications` is **never loaded** in Expo Go — not imported, not
evaluated, not touched. Everything else works: signup, cats, feeding, cleaning,
vet, weight, the notification centre and the digest preview. Settings shows a
plain note saying push is off rather than a warning. Switch to a development
build and it all resumes with no code change.

**A runtime `if` is not enough.** A static
`import * as Notifications from "expo-notifications"` is evaluated when the
importing module first loads, which happens before any guard can run — the
module's side effects and its native-module lookup fire regardless of what the
code then decides. That is what crashed Expo Go, and it is why the guard lives
at the import boundary:

- `src/lib/notifications-lazy.ts` is the **only** place that names the package.
  It `require`s it inside a function, so evaluation is deferred to first call,
  and returns `null` in Expo Go, where that call never happens. Metro still
  bundles the package — bundling is not evaluation, and evaluation is what
  breaks.
- `src/lib/runtime.ts` holds `isExpoGo()` on its own, importing only `expo`.
  When this lived in `push.ts`, importing the guard dragged in the very module
  it was guarding against.
- `src/lib/push.ts` reaches the module only through the lazy loader, so every
  function is a safe no-op and importing the file costs nothing in Expo Go.
- `NotificationRouter` is split in two: a hook-free outer component that returns
  `null` when the module is unavailable, and a child holding all the hooks —
  including `useLastNotificationResponse` — that only ever mounts in a real
  build. Returning early before hooks is safe because the condition is constant
  for the life of the process.

The check itself is `isRunningInExpoGo()` from the `expo` package, which probes
for the native `ExpoGo` module — the most direct signal available, and the one
`expo-notifications` uses internally. Two alternatives that look right and are
not: `Constants.executionEnvironment` reports `storeClient` for Expo Go **and**
for a dev-client build, where push must keep working; and
`Constants.expoGoConfig` falls back to the embedded manifest, so it can be
non-null in a standalone build. (`Constants.appOwnership === "expo"` also works
but is deprecated.)

Beyond Expo Go, `src/lib/push.ts` still degrades gracefully: a missing project
id or a refused permission leaves the app fully usable, with the Settings screen
explaining why alerts are not arriving — and offering the system-settings
shortcut only for the one case it can actually fix.

### One-time setup

```bash
npm install -g eas-cli
eas login
eas init                    # creates the EAS project and prints its id
```

Put that id in `.env` as `EAS_PROJECT_ID` (it is read by `app.config.ts` into
`extra.eas.projectId`, which is where `getExpoPushTokenAsync` looks).

**Android — FCM V1.** Create a Firebase project, add an Android app with package
`com.catterytracker.app`, download `google-services.json`, then either drop it in
this folder or upload it as an EAS file secret and set `GOOGLE_SERVICES_JSON` to
its path. Upload the FCM V1 service-account key with `eas credentials`
(Android → push notifications). `app.config.ts` only wires
`googleServicesFile` when the env var is set, so a checkout without the file
still builds.

**iOS — APNs.** Needs a paid Apple Developer account. `eas build` offers to
generate the APNs key on first run; `eas credentials` manages it afterwards.

### Build

```bash
npm run build:dev       # development build — install once, then `npx expo start`
npm run build:preview   # internal APK / ad-hoc iOS
npm run build:prod      # store builds
```

Profiles live in `eas.json`. Each sets its own `EXPO_PUBLIC_API_URL`, so the
preview build points at staging and production at production — update those two
URLs to your Railway domains before shipping.

### Verifying push end to end

1. Install the development build on a physical device and sign in — the app
   registers its token with `POST /devices` on every launch.
2. Confirm the row exists: `GET /api/v1/devices`.
3. Trigger something: `POST /api/v1/due-summary/send-digest`, or let the backend
   worker's overdue sweep fire.
4. The notification's `channelId` is `default`, matching the Android channel
   created in `src/lib/push.ts`. A mismatch means silent delivery on Android.

## Layout

```
app/                      expo-router file routes
  _layout.tsx             providers, foreground handler, notification routing
  index.tsx               session gate → tabs or login
  (auth)/login, signup
  (tabs)/
    index.tsx             Today — what's due, one-tap complete
    cats.tsx              cat list
    care.tsx              Feeding / Cleaning / Vet behind a segmented control
    notifications.tsx     notification centre + digest preview
    settings.tsx          profile, digest time, per-task-type thresholds
  cats/[catId].tsx        cat detail: weight chart, schedules, vet records
src/
  lib/      api client, auth, storage, formatting, responsive
    runtime.ts             isExpoGo() — imports only `expo`
    notifications-lazy.ts  the one module that names expo-notifications
    push.ts                registration, all of it lazy-guarded
  components/  ui primitives, care-* screens, weight chart
```

### Why five tabs, not seven

The web app has a seven-item sidebar. Seven tabs do not fit a phone tab bar, so
feeding, cleaning and vet share one **Care** tab with a segmented control. Every
feature from the web app is present.

## Phone and tablet

`src/lib/responsive.ts` reads `useWindowDimensions`, so the layout follows a
tablet being rotated or an iPad split view being resized rather than freezing at
launch orientation.

| Width | Behaviour |
| --- | --- |
| < 768pt | Single column, bottom sheets, compact tab bar |
| ≥ 768pt | Two-column card grids, centred dialogs, taller tab bar, larger titles |
| ≥ 1024pt | Three-column grids |

Content is capped at 900pt and centred so text does not stretch across a 12"
screen. Tap targets are at least 44pt.

## Auth

Tokens live in SecureStore (Keychain / Android Keystore) via
`src/lib/storage.ts`, cached in memory after the first read. `src/lib/api.ts`
rotates a 401 once and replays the request; concurrent 401s share one rotation
because the backend's refresh tokens are single-use.

Requests carry a 20-second timeout — without one, a phone on a flaky connection
leaves screens stuck on a spinner forever. A network failure is reported as
"No connection" and does **not** sign the user out; only a real 401/403 does.

Signing out deletes this device's push registration first, while the token still
works, so the alerts do not follow the account onto a phone it no longer owns.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | yes | Backend base URL. Inlined at build time — changing it needs a rebuild |
| `EAS_PROJECT_ID` | for push | From `eas init` |
| `GOOGLE_SERVICES_JSON` | Android push | Path to `google-services.json` |

## Notes

- `.npmrc` sets `legacy-peer-deps=true`: expo-router pulls a `react-dom` whose
  peer range is ahead of the react version the SDK pins. The web target is not
  what this app ships, so the conflict is inert, but a plain `npm install`
  fails on strict peer checks without it.
- The weight chart is drawn with plain `View`s rather than `react-native-svg` —
  a bar chart this small does not justify another native dependency in the
  build.

## Not built yet

- Editing a cat's details from the detail screen (add, retire and delete work).
- Cleaning and feeding history views — the data and endpoints exist.
- Date and time entry is typed (`YYYY-MM-DD`, `HH:MM`) and validated rather
  than using a native picker.
