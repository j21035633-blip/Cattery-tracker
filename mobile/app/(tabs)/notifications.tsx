import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { TASK_LABELS, relativeToNow } from "@/lib/format";
import { clearBadge } from "@/lib/push";
import type { AppNotification, DigestPreview } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Screen,
  Switch,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function NotificationsScreen() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [page, digest] = await Promise.all([
        api.notifications.list({ unread_only: unreadOnly || undefined, limit: 100 }),
        api.due.digestPreview(),
      ]);
      setItems(page.items);
      setPreview(digest);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not load notifications.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [unreadOnly]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // Opening the centre is the moment the app badge stops being useful.
      void clearBadge();
    }, [load]),
  );

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.moss500}
        />
      }
    >
      <PageHeader
        title="Alerts"
        subtitle="Daily digest and overdue alerts"
        action={
          <Button
            title="Read all"
            variant="secondary"
            size="sm"
            onPress={async () => {
              await api.notifications.readAll();
              await load();
            }}
          />
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      {preview ? (
        <Card style={styles.preview}>
          <Text style={styles.previewLabel}>Today&apos;s digest preview</Text>
          <Text style={styles.previewTitle}>{preview.title}</Text>
          <Text style={styles.previewBody}>{preview.body}</Text>
        </Card>
      ) : null}

      <Switch label="Unread only" value={unreadOnly} onChange={setUnreadOnly} />

      {items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "Nothing unread." : "No notifications yet."}
          hint="The daily digest arrives at your chosen time, and overdue alerts appear as tasks pass their threshold."
        />
      ) : (
        items.map((notification) => (
          <Card
            key={notification.id}
            style={StyleSheet.flatten([
              styles.item,
              !notification.is_read && styles.itemUnread,
            ])}
          >
            <View style={styles.itemTop}>
              <Text style={styles.itemTitle}>{notification.title}</Text>
              <Badge tone={notification.type === "overdue" ? "overdue" : "neutral"}>
                {notification.type === "daily_digest"
                  ? "Digest"
                  : notification.task_type
                    ? TASK_LABELS[notification.task_type]
                    : notification.type}
              </Badge>
            </View>
            <Text style={styles.itemBody}>{notification.body}</Text>
            <View style={styles.itemFooter}>
              <Text style={styles.itemTime}>
                {relativeToNow(notification.created_at)}
                {notification.push_sent_at ? " · pushed" : ""}
              </Text>
              <View style={styles.itemActions}>
                {!notification.is_read ? (
                  <Button
                    title="Read"
                    size="sm"
                    variant="ghost"
                    onPress={async () => {
                      await api.notifications.markRead(notification.id);
                      await load();
                    }}
                  />
                ) : null}
                <Button
                  title="Delete"
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await api.notifications.remove(notification.id);
                    await load();
                  }}
                />
              </View>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    backgroundColor: colors.moss50,
    borderColor: "#4a7c5933",
    marginBottom: spacing.md,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.moss700,
  },
  previewTitle: { marginTop: 4, fontSize: 16, fontWeight: "600", color: colors.ink },
  previewBody: { marginTop: 6, fontSize: 13, color: colors.inkMuted, lineHeight: 19 },

  item: { marginBottom: spacing.sm },
  itemUnread: { borderLeftWidth: 4, borderLeftColor: colors.moss500 },
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  itemTitle: { fontSize: 15, fontWeight: "600", color: colors.ink, flexShrink: 1 },
  itemBody: { marginTop: 6, fontSize: 13, color: colors.inkMuted, lineHeight: 19 },
  itemFooter: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  itemTime: { fontSize: 12, color: colors.inkFaint },
  itemActions: { flexDirection: "row", gap: spacing.xs },
});
