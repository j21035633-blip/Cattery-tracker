import { isExpoGo } from "./runtime";

/**
 * Lazy access to `expo-notifications`.
 *
 * A static `import * as Notifications from "expo-notifications"` is evaluated
 * when the importing module is first loaded, which happens before any runtime
 * guard can run — the module's side effects and its native-module lookup fire
 * regardless of what the code goes on to decide. That is enough to crash Expo
 * Go, where the native module backing remote push is not present.
 *
 * So the module is pulled in with `require` inside a function instead:
 * evaluation is deferred to the first call, and in Expo Go that call never
 * happens. Metro still *bundles* the package (its imports are static from the
 * bundler's point of view), but bundling is not evaluation, and it is
 * evaluation that breaks.
 *
 * `typeof import(...)` below is a **type-only** import. TypeScript erases it,
 * so it adds no runtime require.
 */
export type NotificationsModule = typeof import("expo-notifications");

let cached: NotificationsModule | null | undefined;

/**
 * The `expo-notifications` module, or `null` in Expo Go.
 *
 * Every caller must handle `null` — that is the whole contract. The result is
 * memoised, including the negative case, so Expo Go pays one `appOwnership`
 * check for the life of the process.
 */
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;

  if (isExpoGo()) {
    cached = null;
    return cached;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    // A build without the native module linked: treat it exactly like Expo Go
    // rather than taking the app down.
    cached = null;
  }
  return cached;
}

/** True when notifications are usable in this runtime. */
export function notificationsAvailable(): boolean {
  return getNotifications() !== null;
}
