import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { formatDate, parseDateInput } from "@/lib/format";
import type { Cat, VetRecord, VetRecordType } from "@/lib/types";
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
  Sheet,
  Switch,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

const RECORD_TYPES: { label: string; value: VetRecordType }[] = [
  { label: "Appointment", value: "appointment" },
  { label: "Vaccination", value: "vaccination" },
  { label: "Medication", value: "medication" },
  { label: "Treatment", value: "treatment" },
  { label: "Note", value: "note" },
];

export function CareVet({ reloadKey }: { reloadKey: number }) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [records, setRecords] = useState<VetRecord[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState<VetRecord | null>(null);
  const [followUp, setFollowUp] = useState("");

  const [form, setForm] = useState({
    cat_id: "",
    record_type: "vaccination" as VetRecordType,
    title: "",
    due: "",
    vet_name: "",
  });

  const catNames = useMemo(
    () => Object.fromEntries(cats.map((cat) => [cat.id, cat.name])),
    [cats],
  );

  const load = useCallback(async () => {
    try {
      const [catPage, recordPage] = await Promise.all([
        api.cats.list({ is_active: true, limit: 200 }),
        api.vet.list({ outstanding: showCompleted ? undefined : true, limit: 200 }),
      ]);
      setCats(catPage.items);
      setRecords(recordPage.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load vet records.");
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function create() {
    const due = parseDateInput(form.due);
    if (!due) {
      setError("Due date must look like 2026-03-15 (optionally with 14:30).");
      return;
    }

    setSaving(true);
    try {
      await api.vet.create({
        cat_id: form.cat_id,
        record_type: form.record_type,
        title: form.title.trim(),
        due_at: due.toISOString(),
        vet_name: form.vet_name.trim() || null,
      });
      setSheetOpen(false);
      setForm({ ...form, title: "", due: "" });
      setError(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the record.");
    } finally {
      setSaving(false);
    }
  }

  function openComplete(record: VetRecord) {
    setCompleting(record);
    // Vaccinations are usually annual; pre-fill next year to save a step.
    if (record.record_type === "vaccination" && record.due_at) {
      const next = new Date(record.due_at);
      next.setFullYear(next.getFullYear() + 1);
      setFollowUp(next.toISOString().slice(0, 10));
    } else {
      setFollowUp("");
    }
  }

  async function confirmComplete() {
    if (!completing) return;
    const next = followUp.trim() ? parseDateInput(followUp) : null;
    if (followUp.trim() && !next) {
      setError("Follow-up date must look like 2027-03-15.");
      return;
    }

    setSaving(true);
    try {
      await api.vet.complete(completing.id, {
        next_due_at: next ? next.toISOString() : undefined,
      });
      setCompleting(null);
      setFollowUp("");
      setError(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not complete that.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(record: VetRecord) {
    Alert.alert("Delete record", `Delete “${record.title}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await api.vet.remove(record.id);
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
        <Button
          title="New record"
          size="sm"
          disabled={cats.length === 0}
          onPress={() => setSheetOpen(true)}
        />
      </View>

      <Switch
        label="Include completed records"
        value={showCompleted}
        onChange={setShowCompleted}
      />

      {records.length === 0 ? (
        <EmptyState
          title={showCompleted ? "No vet records yet." : "Nothing outstanding."}
          hint="Add an appointment or a vaccination due date to get reminders."
        />
      ) : (
        <Grid>
          {records.map((record) => {
            const overdue =
              !record.completed_at &&
              record.due_at !== null &&
              new Date(record.due_at) < new Date();
            return (
              <Card key={record.id}>
                <View style={styles.cardTop}>
                  <Text style={styles.title}>{record.title}</Text>
                  <Badge tone={record.completed_at ? "done" : overdue ? "overdue" : "due"}>
                    {record.completed_at ? "Done" : overdue ? "Overdue" : record.record_type}
                  </Badge>
                </View>
                <Text style={styles.meta}>
                  {catNames[record.cat_id] ?? "Cat"}
                  {record.due_at ? ` · due ${formatDate(record.due_at)}` : ""}
                  {record.vet_name ? ` · ${record.vet_name}` : ""}
                </Text>
                {!record.completed_at ? (
                  <View style={styles.cardActions}>
                    <Button title="Mark done" size="sm" onPress={() => openComplete(record)} />
                    <Button
                      title="Delete"
                      size="sm"
                      variant="ghost"
                      onPress={() => confirmDelete(record)}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })}
        </Grid>
      )}

      <Sheet visible={sheetOpen} title="New vet record" onClose={() => setSheetOpen(false)}>
        <Field label="Cat">
          <ChipGroup
            options={cats.map((cat) => ({ label: cat.name, value: cat.id }))}
            value={form.cat_id}
            onChange={(value) => setForm({ ...form, cat_id: value })}
          />
        </Field>
        <Field label="Type">
          <ChipGroup
            options={RECORD_TYPES}
            value={form.record_type}
            onChange={(value) => setForm({ ...form, record_type: value })}
          />
        </Field>
        <Field label="Title">
          <Input
            value={form.title}
            onChangeText={(value) => setForm({ ...form, title: value })}
            placeholder="Rabies booster"
          />
        </Field>
        <Field label="Due" hint="YYYY-MM-DD, optionally with HH:MM">
          <Input
            value={form.due}
            onChangeText={(value) => setForm({ ...form, due: value })}
            placeholder="2026-09-15"
            keyboardType="numbers-and-punctuation"
          />
        </Field>
        <Field label="Vet">
          <Input
            value={form.vet_name}
            onChangeText={(value) => setForm({ ...form, vet_name: value })}
          />
        </Field>
        <Button
          title={saving ? "Saving…" : "Create record"}
          onPress={create}
          disabled={saving || !form.cat_id || !form.title.trim()}
        />
      </Sheet>

      <Sheet
        visible={completing !== null}
        title={`Complete “${completing?.title ?? ""}”`}
        onClose={() => setCompleting(null)}
      >
        <Field
          label="Book the follow-up"
          hint="Optional. Creates a new record so this one stays in the history."
        >
          <Input
            value={followUp}
            onChangeText={setFollowUp}
            placeholder="2027-09-15"
            keyboardType="numbers-and-punctuation"
          />
        </Field>
        <Button
          title={saving ? "Saving…" : "Mark done"}
          onPress={confirmComplete}
          disabled={saving}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink, flexShrink: 1 },
  meta: { marginTop: 6, fontSize: 13, color: colors.inkMuted },
  cardActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
});
