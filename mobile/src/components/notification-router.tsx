import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "@/lib/auth";
import { getNotifications, type NotificationsModule } from "@/lib/notifications-lazy";

/**
 * Opens the right screen when a push is tapped.
 *
 * Split in two on purpose. This outer component holds **no hooks**, so it can
 * return early when `expo-notifications` is unavailable (Expo Go) without
 * breaking the rules of hooks. All the hook usage — including the notifications
 * hook itself — lives in the child, which only ever mounts in a real build.
 *
 * The condition is constant for the life of the process, so the child either
 * always renders or never does; its hook order can never change.
 */
export function NotificationRouter() {
  const notifications = getNotifications();
  if (!notifications) return null;
  return <PushResponseRouter notifications={notifications} />;
}

/**
 * `useLastNotificationResponse` is used rather than
 * `addNotificationResponseReceivedListener` because it also reports the
 * notification that *launched* the app from cold — a plain listener is
 * registered too late to see that one, so tapping an alert on a killed app
 * would just open the dashboard.
 *
 * Rendered inside `AuthProvider` so it can wait for a session: navigating into
 * the tabs before sign-in would only bounce the user back to /login.
 */
function PushResponseRouter({ notifications }: { notifications: NotificationsModule }) {
  const response = notifications.useLastNotificationResponse();
  const router = useRouter();
  const { user } = useAuth();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !user) return;

    // The hook keeps returning the same response; act on each one once.
    const identifier = response.notification.request.identifier;
    if (handled.current === identifier) return;
    handled.current = identifier;

    const data = response.notification.request.content.data as
      | { screen?: string }
      | undefined;

    switch (data?.screen) {
      case "feeding":
      case "cleaning":
      case "vet":
      case "vaccination":
      case "medication":
        // All three live behind the Care tab on mobile.
        router.push("/(tabs)/care");
        break;
      case "digest":
        router.push("/(tabs)");
        break;
      default:
        router.push("/(tabs)/notifications");
    }
  }, [response, user, router]);

  return null;
}
