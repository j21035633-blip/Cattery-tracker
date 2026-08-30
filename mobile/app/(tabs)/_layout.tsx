import { Redirect, Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResponsive } from "@/lib/responsive";
import { Loading, Screen } from "@/components/ui";
import { colors } from "@/theme";

/**
 * Five tabs, not seven.
 *
 * The web app has a seven-item sidebar, which does not fit a phone tab bar, so
 * feeding / cleaning / vet are combined behind one "Care" tab with a segmented
 * control. Same features, layout that suits the device.
 */
const TABS = [
  { name: "index", title: "Today", icon: "◉" },
  { name: "cats", title: "Cats", icon: "◐" },
  { name: "care", title: "Care", icon: "◇" },
  { name: "notifications", title: "Alerts", icon: "◆" },
  { name: "settings", title: "Settings", icon: "⚙" },
] as const;

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { isTablet } = useResponsive();
  const [unread, setUnread] = useState(0);

  // Poll the badge so an alert raised by the backend sweep appears without a
  // push having to land (and while the app is already open).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const { unread: count } = await api.notifications.unreadCount();
        if (!cancelled) setUnread(count);
      } catch {
        /* the badge is not worth an error state */
      }
    };

    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.moss600,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          // A tablet tab bar sits higher and reads better with more room.
          height: isTablet ? 68 : 58,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: isTablet ? 13 : 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: isTablet ? 20 : 18 }}>{tab.icon}</Text>
            ),
            tabBarBadge:
              tab.name === "notifications" && unread > 0
                ? unread > 99
                  ? "99+"
                  : unread
                : undefined,
          }}
        />
      ))}
    </Tabs>
  );
}
