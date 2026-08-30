import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NotificationRouter } from "@/components/notification-router";
import { AuthProvider } from "@/lib/auth";
import { configureForegroundHandler } from "@/lib/push";
import { colors } from "@/theme";

// Still at module scope so the handler is in place before any notification can
// be delivered in a real build. Safe here because it no longer touches
// `expo-notifications` at import time — in Expo Go it returns immediately.
configureForegroundHandler();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <NotificationRouter />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.cream },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="cats/[catId]"
              options={{
                headerShown: true,
                title: "Cat",
                headerStyle: { backgroundColor: colors.cream },
                headerTintColor: colors.ink,
              }}
            />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
