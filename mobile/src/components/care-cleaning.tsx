import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { formatDateTime, humaniseMinutes, relativeToNow } from "@/lib/format";
import type { CleaningTask } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorNote,
  Field,
  Grid,
  Input,
  Loading,
  SectionTitle,
  Sheet,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

const INTERVALS = [
  { label: "Twice a day", value: 12 },
  { label: "Daily", value: 24 },
  { label: "Every 2 days", value: 48 },
  { label: "Weekly", value: 168 },
  { label: "Fortnightly", value: 336 },
];

export function CareCleaning({ reloadKey }: { reloadKey: number }) {
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "Scoop litter", zone: "", interval_hours: 24 });

  const load = useCallback(async () => {
    try {
      const page = await api.cleaning.listTasks({ limit: 200 });
      setTasks(page.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load cleaning.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Grouped by zone, which is what makes the rotation legible.
  const byZone = useMemo(() => {
    const groups = new Map<string, CleaningTask[]>();
    for (const task of tasks) {
      const list = groups.get(task.zone) ?? [];
      list.push(task);
      groups.set(task.zone, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.rotation_order - b.rotation_order);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  async function create() {
    setSaving(true);
    try {
      await api.cleaning.createTask({
        name: form.name.trim(),
        zone: form.zone.trim(),
        interval_hours: form.interval_hours,
      });
      setSheetOpen(false);
      setForm({ ...form, zone: "" });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the task.");
    } finally {
      setSaving(false);
    }
  }

  async function complete(taskId: string) {
    setBusyId(taskId);
    try {
      await api.cleaning.complete(taskId);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not record that.");
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(task: CleaningTask) {
    Alert.alert("Delete task", `Delete “${task.name}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.cleaning.removeTask(task.id);
          await load();
        },
      },
    ]);
  }

  if (loading) return <Loading />;

  return (
    <View>
      {error ? <ErrorNote message={error} /> : null}

      <View style={styles.actions}>
        <Button title="New task" size="sm" onPress={() => setSheetOpen(true)} />
      </View>

      {tasks.length === 0 ? (
        <EmptyState
          title="No cleaning tasks yet."
          hint="Add one per zone — a litter box, a room, a pen — and the rotation takes care of itself."
        />
      ) : (
        byZone.map(([zone, zoneTasks]) => (
          <View key={zone}>
            <SectionTitle>{zone}</SectionTitle>
            <Grid>
              {zoneTasks.map((task) => {
                const lateMinutes = Math.round(
                  (Date.now() - new Date(task.next_due_at).getTime()) / 60000,
                );
                const isLate = lateMinutes > 0;
                return (
                  <Card key={task.id}>
                    <View style={styles.cardTop}>
                      <Text style={styles.name}>{task.name}</Text>
                      <Badge tone={isLate ? "overdue" : "done"}>
                        {isLate ? `${humaniseMinutes(lateMinutes)} late` : "On track"}
                      </Badge>
                    </View>
                    <Text style={styles.meta}>
                      Due {formatDateTime(task.next_due_at)}
                    </Text>
                    <Text style={styles.metaFaint}>
                      Every {humaniseMinutes(task.interval_hours * 60)}
                      {task.last_completed_at
                        ? ` · last done ${relativeToNow(task.last_completed_at)}`
                        : ""}
                    </Text>
                    <View style={styles.cardActions}>
                      <Button
                        title={busyId === task.id ? "Saving…" : "Mark cleaned"}
                        size="sm"
                        disabled={busyId === task.id}
                        onPress={() => complete(task.id)}
                      />
                      <Button
                        title="Delete"
                        size="sm"
                        variant="ghost"
                        onPress={() => confirmDelete(task)}
                      />
                    </View>
                  </Card>
                );
              })}
            </Grid>
          </View>
        ))
      )}

      <Sheet visible={sheetOpen} title="New cleaning task" onClose={() => setSheetOpen(false)}>
        <Field label="Task">
          <Input
            value={form.name}
            onChangeText={(value) => setForm({ ...form, name: value })}
            placeholder="Scoop litter"
          />
        </Field>
        <Field label="Zone" hint="Litter box, room or pen this covers">
          <Input
            value={form.zone}
            onChangeText={(value) => setForm({ ...form, zone: value })}
            placeholder="Main room"
          />
        </Field>
        <Field label="How often">
          <ChipGroup
            options={INTERVALS}
            value={form.interval_hours}
            onChange={(value) => setForm({ ...form, interval_hours: value })}
          />
        </Field>
        <Button
          title={saving ? "Saving…" : "Create task"}
          onPress={create}
          disabled={saving || !form.name.trim() || !form.zone.trim()}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  name: { fontSize: 16, fontWeight: "600", color: colors.ink, flexShrink: 1 },
  meta: { marginTop: 6, fontSize: 13, color: colors.inkMuted },
  metaFaint: { marginTop: 2, fontSize: 12, color: colors.inkFaint },
  cardActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
});
