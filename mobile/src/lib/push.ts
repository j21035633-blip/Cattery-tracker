/**
 * Native push registration (Expo SDK 57).
 *
 * Why this only works in a dev build or an EAS build, never Expo Go:
 * remote push was removed from Expo Go on Android in SDK 53, and the token
 * Expo Go hands out on iOS belongs to Expo's own project, not ours. A real
 * build is the only way to get a token that our backend can push to. See the
 * README for the credential setup (FCM V1 on Android, APNs key on iOS).
 *
 * **`expo-notifications` is never imported at module scope here.** It is
 * reached only through `getNotifications()`, which returns `null` in Expo Go —
 * see `notifications-lazy.ts` for why a static import is not good enough.
 * Every function below is a safe no-op when the module is unavailable, so
 * importing this file costs nothing in Expo Go.
 *
 * The flow in a real build:
 *   1. Create the Android channel — required before asking for a token on
 *      Android 13+, and its id must match the `channelId` the backend sends.
 *   2. Ask for permission (a no-op if already granted).
 *   3. Fetch the Expo push token for *our* EAS project id.
 *   4. POST it to /devices, which is idempotent, so this can run every launch.
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { api } from "./api";
import { getNotifications } from "./notifications-lazy";
import { isExpoGo } from "./runtime";

export { isExpoGo } from "./runtime";

/** Must match `channelId` in backend/app/services/push.py. */
export const ANDROID_CHANNEL_ID = "default";

export type PushRegistrationResult =
  | { status: "registered"; token: string }
  | { status: "denied" }
  /** Deliberately not attempted — Expo Go. Expected, not a fault. */
  | { status: "skipped"; reason: string }
  | { status: "unsupported"; reason: string };

const EXPO_GO_REASON =
  "Running in Expo Go, which cannot receive push for this project. " +
  "Everything else works; make a development build to test notifications.";

/**
 * How a notification behaves while the app is in the foreground.
 *
 * Safe to call at module scope: in Expo Go it returns without touching
 * `expo-notifications` at all.
 *
 * SDK 57 replaced `shouldShowAlert` with the banner/list pair; passing the old
 * field silently shows nothing.
 */
export function configureForegroundHandler(): void {
  const notifications = getNotifications();
  if (!notifications) return;

  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

function resolveProjectId(): string | undefined {
  const config = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return (
    config?.eas?.projectId ??
    // easConfig is populated in builds made by EAS.
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId ??
    process.env.EAS_PROJECT_ID
  );
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  const notifications = getNotifications();
  if (!notifications) return;

  await notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Reminders",
    importance: notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#4a7c59",
  });
}

/**
 * Register this device for push and tell the backend about it.
 *
 * Never throws: a device that cannot receive push should still be able to use
 * the app, with the in-app notification centre as the fallback.
 */
export async function registerForPush(): Promise<PushRegistrationResult> {
  // Checked before anything else, so Expo Go shows no permission prompt and
  // never registers a token the backend could not push to anyway.
  const notifications = getNotifications();
  if (!notifications) {
    return {
      status: "skipped",
      reason: isExpoGo()
        ? EXPO_GO_REASON
        : "The notifications native module is not available in this build.",
    };
  }

  if (!Device.isDevice) {
    return {
      status: "unsupported",
      reason: "Push notifications need a physical device or an emulator with Play services.",
    };
  }

  // Channel first — Android 13+ requires it before the token request.
  await ensureAndroidChannel();

  const existing = await notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const requested = await notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted = requested.granted;
  }
  if (!granted) return { status: "denied" };

  const projectId = resolveProjectId();
  if (!projectId) {
    return {
      status: "unsupported",
      reason:
        "No EAS project id. Run `eas init` and set EAS_PROJECT_ID, then rebuild — " +
        "Expo Go cannot deliver push for this project.",
    };
  }

  try {
    const { data: token } = await notifications.getExpoPushTokenAsync({ projectId });
    await api.devices.register({
      expo_push_token: token,
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
      device_name: Device.deviceName ?? undefined,
    });
    return { status: "registered", token };
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : "Could not obtain a push token.",
    };
  }
}

/** Clear the badge — called after the notification centre is opened. */
export async function clearBadge(): Promise<void> {
  const notifications = getNotifications();
  if (!notifications) return;

  try {
    await notifications.setBadgeCountAsync(0);
  } catch {
    /* badges are unsupported on some launchers */
  }
}
