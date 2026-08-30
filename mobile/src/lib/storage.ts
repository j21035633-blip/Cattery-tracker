import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Token storage.
 *
 * Native builds use the Keychain / Android Keystore through SecureStore, which
 * is the point of storing auth tokens rather than dropping them in AsyncStorage.
 * SecureStore is unavailable on web, so the web target falls back to
 * localStorage — the same place the Next.js app keeps them.
 */

const isWeb = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    // A corrupt keychain entry must not brick the app; treat it as signed out.
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    /* storage is best-effort; the session still works for this launch */
  }
}

export async function deleteItem(key: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    /* nothing useful to do if the delete fails */
  }
}
