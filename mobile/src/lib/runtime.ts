import { isRunningInExpoGo } from "expo";

/**
 * Runtime environment checks.
 *
 * Deliberately kept in its own module that imports **only** the tiny `expo`
 * entry point. When this lived in `push.ts`, importing `isExpoGo` also pulled
 * in `expo-notifications`, which defeats the point of guarding against it.
 */

/**
 * True when running inside Expo Go, as opposed to a dev build or an EAS build.
 *
 * `isRunningInExpoGo()` probes for the native `ExpoGo` module, which exists
 * only in the Expo Go client — the most direct signal there is, and the same
 * one `expo-notifications` uses internally to decide whether to warn.
 *
 * Two alternatives that look right and are not:
 *
 * - `Constants.executionEnvironment` reports `storeClient` for Expo Go **and**
 *   for a dev-client development build, and push must keep working in the
 *   second one.
 * - `Constants.expoGoConfig` falls back to returning the embedded manifest, so
 *   it can be non-null in a standalone build.
 *
 * (`Constants.appOwnership === "expo"` does work, but it is deprecated; this is
 * the supported replacement for exactly this question.)
 */
export function isExpoGo(): boolean {
  return isRunningInExpoGo();
}
