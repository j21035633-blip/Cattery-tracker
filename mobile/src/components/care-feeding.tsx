import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { WEEKDAYS, describeDays, formatTime, normaliseTimeInput, trimSeconds } from "@/lib/format";
import type { Cat, FeedingEvent, FeedingSchedule } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  SectionTitle,
  Sheet,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function CareFeeding({ reloadKey }: { reloadKey: number }) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [schedules, setSchedules] = useState<FeedingSchedule[]>([]);
  const [events, setEvents] = useState<FeedingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState({
    cat_id: "",
    label: "Breakfast",
    time: "07:30",
    days: [...ALL_DAYS],
    food_type: "",
    portion_amount: "",
  });

  const catNames = useMemo(
    () => Object.fromEntries(cats.map((cat) => [cat.id, cat.name])),
    [cats],
  );

  const load = useCallback(async () => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const [catPage, schedulePage, eventPage] = await Promise.all([
        api.cats.list({ is_active: true, limit: 200 }),
        api.feeding.listSchedules({ limit: 200 }),
        api.feeding.listEvents({
          due_from: start.toISOString(),
          due_to: end.toISOString(),
          limit: 200,
        }),
      ]);
      setCats(catPage.items);
      setSchedules(schedulePage.items);
      setEvents(eventPage.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load feeding.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function createSchedule() {
    const scheduledTime = normaliseTimeInput(form.time);
    if (!scheduledTime) {
      setError("Time must look like 07:30.");
      return;
    }
    if (form.days.length === 0) {
      setError("Pick at least one day.");
      return;
    }

    setSaving(true);
    try {
      await api.feeding.createSchedule({
        cat_id: form.cat_id,
        label: form.label.trim(),
        scheduled_time: scheduledTime,
        days_of_week: form.days,
        food_type: form.food_type.trim() || null,
        portion_amount: form.portion_amount.trim() || null,
        portion_unit: form.portion_amount.trim() ? "g" : null,
      });
      setSheetOpen(false);
      setError(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function act(eventId: string, action: "complete" | "skip") {
    setBusyId(eventId);
    try {
      if (action === "complete") await api.feeding.complete(eventId);
      else await api.feeding.skip(eventId);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update that.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading />;

  return (
    <View>
      {error ? <ErrorNote message={error} /> : null}

      <View style={styles.actions}>
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
        <Button
          title="New schedule"
          size="sm"
          disabled={cats.length === 0}
          onPress={() => setSheetOpen(true)}
        />
      </View>

      <SectionTitle>Today</SectionTitle>
      {events.length === 0 ? (
        <EmptyState
          title="Nothing scheduled for today yet."
          hint="Use “Build today” to create today's feedings from the schedules."
        />
      ) : (
        events.map((event) => (
          <Card key={event.id} style={styles.row}>
            <View style={styles.rowInner}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{catNames[event.cat_id] ?? "Cat"}</Text>
                <Text style={styles.rowMeta}>{formatTime(event.due_at)}</Text>
              </View>
              <View style={styles.rowActions}>
                <Badge
                  tone={
                    event.status === "completed"
                      ? "done"
                      : event.status === "missed"
                        ? "overdue"
                        : "neutral"
                  }
                >
                  {event.status}
                </Badge>
                {event.status === "pending" ? (
                  <>
                    <Button
                      title="Fed"
                      size="sm"
                      disabled={busyId === event.id}
                      onPress={() => act(event.id, "complete")}
                    />
                    <Button
                      title="Skip"
                      size="sm"
                      variant="ghost"
                      disabled={busyId === event.id}
                      onPress={() => act(event.id, "skip")}
                    />
                  </>
                ) : null}
              </View>
            </View>
          </Card>
        ))
      )}

      <SectionTitle>Schedules</SectionTitle>
      {schedules.length === 0 ? (
        <EmptyState title="No schedules yet." />
      ) : (
        schedules.map((schedule) => (
          <Card key={schedule.id} style={styles.row}>
            <View style={styles.rowInner}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {schedule.label} · {catNames[schedule.cat_id] ?? "Cat"}
                </Text>
                <Text style={styles.rowMeta}>
                  {trimSeconds(schedule.scheduled_time)} ·{" "}
                  {describeDays(schedule.days_of_week)}
                </Text>
              </View>
              <View style={styles.rowActions}>
                {!schedule.is_active ? <Badge>Paused</Badge> : null}
                <Button
                  title={schedule.is_active ? "Pause" : "Resume"}
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await api.feeding.updateSchedule(schedule.id, {
                      is_active: !schedule.is_active,
                    });
                    await load();
                  }}
                />
              </View>
            </View>
          </Card>
        ))
      )}

      <Sheet
        visible={sheetOpen}
        title="New feeding schedule"
        onClose={() => setSheetOpen(false)}
      >
        <Field label="Cat">
          <ChipGroup
            options={cats.map((cat) => ({ label: cat.name, value: cat.id }))}
            value={form.cat_id}
            onChange={(value) => setForm({ ...form, cat_id: value })}
          />
        </Field>
        <Field label="Label">
          <Input
            value={form.label}
            onChangeText={(value) => setForm({ ...form, label: value })}
          />
        </Field>
        <Field label="Time" hint="24-hour, e.g. 07:30">
          <Input
            value={form.time}
            onChangeText={(value) => setForm({ ...form, time: value })}
            keyboardType="numbers-and-punctuation"
            placeholder="07:30"
          />
        </Field>
        <Field label="Days" hint={describeDays(form.days)}>
          <ChipGroup
            multiple
            selected={form.days}
            options={ALL_DAYS.map((day) => ({ label: WEEKDAYS[day], value: day }))}
            onChange={(day) =>
              setForm((current) => ({
                ...current,
                days: current.days.includes(day)
                  ? current.days.filter((value) => value !== day)
                  : [...current.days, day].sort((a, b) => a - b),
              }))
            }
          />
        </Field>
        <Field label="Food">
          <Input
            value={form.food_type}
            onChangeText={(value) => setForm({ ...form, food_type: value })}
            placeholder="Wet, chicken"
          />
        </Field>
        <Field label="Portion (g)">
          <Input
            value={form.portion_amount}
            onChangeText={(value) => setForm({ ...form, portion_amount: value })}
            keyboardType="decimal-pad"
            placeholder="60"
          />
        </Field>
        <Button
          title={saving ? "Saving…" : "Create schedule"}
          onPress={createSchedule}
          disabled={saving || !form.cat_id}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  row: { marginBottom: spacing.sm },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  rowText: { flexShrink: 1, minWidth: 120 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  rowMeta: { marginTop: 2, fontSize: 13, color: colors.inkMuted },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
