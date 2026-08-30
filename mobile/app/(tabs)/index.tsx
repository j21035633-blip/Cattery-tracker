import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TASK_LABELS, formatTime, humaniseMinutes } from "@/lib/format";
import { useResponsive } from "@/lib/responsive";
import type { DueItem, DueSummary } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  Screen,
  SectionTitle,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function TodayScreen() {
  const { user } = useAuth();
  const { isTablet } = useResponsive();
  const [summary, setSummary] = useState<DueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api.due.summary());
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load today.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch whenever the tab regains focus — completing something on the Care
  // tab should be reflected here without a manual pull.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function complete(item: DueItem) {
    setBusyId(item.entity_id);
    try {
      if (item.task_type === "feeding") await api.feeding.complete(item.entity_id);
      else if (item.task_type === "cleaning") await api.cleaning.complete(item.entity_id);
      else await api.vet.complete(item.entity_id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update that.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !summary) {
    return (
      <Screen scroll={false}>
        <Loading label="Loading today…" />
      </Screen>
    );
  }

  const firstName = user?.full_name?.split(" ")[0];

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
        title={firstName ? `Hello, ${firstName}` : "Today"}
        subtitle={
          summary
            ? new Date(summary.local_date).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : undefined
        }
        action={
          <Button
            title="Build today"
            variant="secondary"
            size="sm"
            onPress={async () => {
              try {
                await api.feeding.generate({ days: 1 });
                await load();
              } catch (caught) {
                setError(
                  caught instanceof ApiError ? caught.message : "Could not build today.",
                );
              }
            }}
          />
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      {summary ? (
        <>
          <View style={styles.stats}>
            <Stat label="Overdue" value={summary.counts.overdue} color={colors.clay600} />
            <Stat label="Due today" value={summary.counts.today} color={colors.amber600} />
            <Stat label="This week" value={summary.counts.upcoming} color={colors.inkMuted} />
          </View>

          <Section
            title="Overdue"
            items={summary.overdue}
            empty="Nothing is late."
            onComplete={complete}
            busyId={busyId}
            overdue
            isTablet={isTablet}
          />
          <Section
            title="Due today"
            items={summary.today}
            empty="Nothing else scheduled today."
            onComplete={complete}
            busyId={busyId}
            isTablet={isTablet}
          />
          <Section
            title="This week"
            items={summary.upcoming}
            empty="No vet or vaccination deadlines coming up."
            onComplete={complete}
            busyId={busyId}
            showDate
            isTablet={isTablet}
          />
        </>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function Section({
  title,
  items,
  empty,
  onComplete,
  busyId,
  overdue = false,
  showDate = false,
  isTablet,
}: {
  title: string;
  items: DueItem[];
  empty: string;
  onComplete: (item: DueItem) => void;
  busyId: string | null;
  overdue?: boolean;
  showDate?: boolean;
  isTablet: boolean;
}) {
  return (
    <View>
      <SectionTitle>{title}</SectionTitle>
      {items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        items.map((item) => (
          <Card key={`${item.task_type}-${item.entity_id}`} style={styles.itemCard}>
            <View style={isTablet ? styles.itemRowTablet : styles.itemRow}>
              <View style={styles.itemText}>
                <View style={styles.itemTitleRow}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Badge tone={overdue ? "overdue" : "neutral"}>
                    {TASK_LABELS[item.task_type]}
                  </Badge>
                </View>
                <Text style={styles.itemMeta}>
                  {showDate
                    ? new Date(item.due_at).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })
                    : formatTime(item.due_at)}
                  {item.cat_name ? ` · ${item.cat_name}` : ""}
                  {overdue ? ` · ${humaniseMinutes(item.overdue_by_minutes)} late` : ""}
                </Text>
              </View>
              <Button
                title={busyId === item.entity_id ? "Saving…" : "Done"}
                size="sm"
                variant={overdue ? "primary" : "secondary"}
                disabled={busyId === item.entity_id}
                onPress={() => onComplete(item)}
              />
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
  statValue: { fontSize: 26, fontWeight: "700" },
  statLabel: { marginTop: 2, fontSize: 12, color: colors.inkFaint },

  itemCard: { marginBottom: spacing.sm },
  itemRow: { gap: spacing.md },
  itemRowTablet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  itemText: { flexShrink: 1, gap: 4 },
  itemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  itemTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  itemMeta: { fontSize: 13, color: colors.inkMuted },
});
