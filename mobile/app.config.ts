import type { ExpoConfig } from "expo/config";

/**
 * Dynamic config so the API URL, the EAS project id and the Android FCM file
 * come from the environment (or from `eas.json`'s per-profile `env`), rather
 * than being committed.
 *
 * `eas init` writes the project id into your EAS account; set it here via
 * EAS_PROJECT_ID so `getExpoPushTokenAsync` can find it.
 */

const projectId = process.env.EAS_PROJECT_ID;

// Referencing a missing google-services.json breaks prebuild, so only include
// it when the file has actually been provided (EAS writes it from a secret).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

const config: ExpoConfig = {
  name: "Cattery Tracker",
  slug: "cattery-tracker",
  scheme: "catterytracker",
  version: "1.0.0",
  // Tablets are landscape-capable; the layouts adapt either way.
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  assetBundlePatterns: ["**/*"],

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.catterytracker.app",
    infoPlist: {
      // Lets a delivered push wake the app so the badge stays accurate.
      UIBackgroundModes: ["remote-notification"],
    },
  },

  android: {
    package: "com.catterytracker.app",
    adaptiveIcon: {
      backgroundColor: "#faf7f2",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // POST_NOTIFICATIONS is required from Android 13; expo-notifications asks
    // for it at runtime, but it must be declared here to be grantable.
    permissions: ["POST_NOTIFICATIONS"],
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },

  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },

  plugins: [
    "expo-router",
    "expo-secure-store",
    // The top-level `splash` key was removed; it is a plugin from SDK 51 on.
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#faf7f2",
      },
    ],
    [
      "expo-notifications",
      {
        color: "#4a7c59",
        // Must match the channelId the backend sends in each push message.
        defaultChannel: "default",
      },
    ],
  ],

  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000",
    ...(projectId ? { eas: { projectId } } : {}),
  },
};

export default config;
