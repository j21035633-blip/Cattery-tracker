import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import {
  catAge,
  describeDays,
  formatDate,
  formatWeight,
  formatWeightDelta,
  trimSeconds,
} from "@/lib/format";
import type { Cat, FeedingSchedule, VetRecord, WeightLog, WeightTrend } from "@/lib/types";
import { WeightChart } from "@/components/weight-chart";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Screen,
  SectionTitle,
  Sheet,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function CatDetailScreen() {
  const { catId } = useLocalSearchParams<{ catId: string }>();
  const router = useRouter();
  const navigation = useNavigation();

  const [cat, setCat] = useState<Cat | null>(null);
  const [schedules, setSchedules] = useState<FeedingSchedule[]>([]);
  const [records, setRecords] = useState<VetRecord[]>([]);
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [trend, setTrend] = useState<WeightTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weightKg, setWeightKg] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!catId) return;
    try {
      const [catData, schedulePage, recordPage, weightPage, trendData] = await Promise.all([
        api.cats.get(catId),
        api.feeding.listSchedules({ cat_id: catId, limit: 50 }),
        api.vet.list({ cat_id: catId, limit: 50 }),
        api.weight.list({ cat_id: catId, limit: 100 }),
        api.cats.weightTrend(catId),
      ]);
      setCat(catData);
      setSchedules(schedulePage.items);
      setRecords(recordPage.items);
      setWeights(weightPage.items);
      setTrend(trendData);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load this cat.");
    } finally {
      setLoading(false);
    }
  }, [catId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Put the cat's name in the stack header once it is known.
  useEffect(() => {
    if (cat) navigation.setOptions({ title: cat.name });
  }, [cat, navigation]);

  async function addWeight() {
    const kg = Number(weightKg);
    if (!Number.isFinite(kg) || kg < 0.1 || kg > 40) {
      setError("Weight must be between 0.10 and 40.00 kg.");
      return;
    }

    setSaving(true);
    try {
      // The API stores grams; the form asks for kg because that is what scales show.
      await api.weight.create({ cat_id: catId!, weight_grams: Math.round(kg * 1000) });
      setWeightKg("");
      setWeighOpen(false);
      setError(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the weight.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!cat) return;
    Alert.alert(
      `Delete ${cat.name}?`,
      "Their schedules, vet records and weight history go too. To keep the history, mark them retired instead.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await api.cats.remove(cat.id);
            router.back();
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }
  if (!cat) {
    return (
      <Screen>
        <ErrorNote message={error ?? "Cat not found."} />
      </Screen>
    );
  }

  return (
    <Screen>
      {error ? <ErrorNote message={error} /> : null}

      <Card style={styles.headerCard}>
        <Text style={styles.name}>{cat.name}</Text>
        <Text style={styles.meta}>
          {[cat.breed, cat.color, catAge(cat.date_of_birth)].filter(Boolean).join(" · ") ||
            "No details yet"}
        </Text>
        <View style={styles.headerActions}>
          <Button
            title={cat.is_active ? "Mark retired" : "Mark active"}
            variant="secondary"
            size="sm"
            onPress={async () => {
              setCat(await api.cats.update(cat.id, { is_active: !cat.is_active }));
            }}
          />
          <Button title="Delete" variant="ghost" size="sm" onPress={confirmDelete} />
        </View>
      </Card>

      <SectionTitle>Weight</SectionTitle>
      <Card>
        {trend && trend.samples > 0 ? (
          <View style={styles.metrics}>
            <Metric label="Latest" value={formatWeight(trend.latest_grams)} />
            <Metric label="Change" value={formatWeightDelta(trend.change_grams)} />
            <Metric label="Readings" value={String(trend.samples)} />
          </View>
        ) : null}
        <WeightChart logs={weights} />
        <Button
          title="Log weight"
          variant="secondary"
          size="sm"
          onPress={() => setWeighOpen(true)}
          style={{ marginTop: spacing.md, alignSelf: "flex-start" }}
        />
      </Card>

      <SectionTitle>Feeding schedules</SectionTitle>
      {schedules.length === 0 ? (
        <EmptyState title="No feeding schedule yet." />
      ) : (
        schedules.map((schedule) => (
          <Card key={schedule.id} style={styles.row}>
            <View style={styles.rowInner}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.rowTitle}>{schedule.label}</Text>
                <Text style={styles.rowMeta}>
                  {trimSeconds(schedule.scheduled_time)} ·{" "}
                  {describeDays(schedule.days_of_week)}
                </Text>
              </View>
              {!schedule.is_active ? <Badge>Paused</Badge> : null}
            </View>
          </Card>
        ))
      )}

      <SectionTitle>Vet &amp; vaccinations</SectionTitle>
      {records.length === 0 ? (
        <EmptyState title="No vet records yet." />
      ) : (
        records.map((record) => (
          <Card key={record.id} style={styles.row}>
            <View style={styles.rowInner}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.rowTitle}>{record.title}</Text>
                <Text style={styles.rowMeta}>
                  {record.record_type}
                  {record.due_at ? ` · due ${formatDate(record.due_at)}` : ""}
                </Text>
              </View>
              <Badge tone={record.completed_at ? "done" : "due"}>
                {record.completed_at ? "Done" : "Outstanding"}
              </Badge>
            </View>
          </Card>
        ))
      )}

      {cat.notes ? (
        <>
          <SectionTitle>Notes</SectionTitle>
          <Card>
            <Text style={styles.notes}>{cat.notes}</Text>
          </Card>
        </>
      ) : null}

      <Sheet
        visible={weighOpen}
        title={`Log weight for ${cat.name}`}
        onClose={() => setWeighOpen(false)}
      >
        <Field label="Weight (kg)" hint="Between 0.10 and 40.00 kg">
          <Input
            value={weightKg}
            onChangeText={setWeightKg}
            keyboardType="decimal-pad"
            placeholder="4.20"
          />
        </Field>
        <Button
          title={saving ? "Saving…" : "Save"}
          onPress={addWeight}
          disabled={saving || !weightKg}
        />
      </Sheet>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: { marginTop: spacing.md },
  name: { fontSize: 24, fontWeight: "700", color: colors.ink },
  meta: { marginTop: 4, fontSize: 14, color: colors.inkMuted },
  headerActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },

  metrics: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  metric: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  metricLabel: { fontSize: 11, color: colors.inkFaint },
  metricValue: { marginTop: 2, fontSize: 15, fontWeight: "600", color: colors.ink },

  row: { marginBottom: spacing.sm },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowMeta: { marginTop: 2, fontSize: 13, color: colors.inkMuted },

  notes: { fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
});
