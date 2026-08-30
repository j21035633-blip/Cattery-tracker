"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiError, api } from "@/lib/api";
import { formatDate, isoToLocalInput, localInputToIso } from "@/lib/format";
import type { Cat, VetRecord, VetRecordType } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

const RECORD_TYPES: VetRecordType[] = [
  "appointment",
  "vaccination",
  "medication",
  "treatment",
  "note",
];

export default function VetPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [records, setRecords] = useState<VetRecord[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState<VetRecord | null>(null);
  const [followUp, setFollowUp] = useState("");

  const [form, setForm] = useState({
    cat_id: "",
    record_type: "vaccination" as VetRecordType,
    title: "",
    due_at: "",
    vet_name: "",
    clinic_name: "",
    description: "",
    reminder_days_before: 7,
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
  }, [load]);

  async function createRecord(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.vet.create({
        cat_id: form.cat_id,
        record_type: form.record_type,
        title: form.title,
        due_at: form.due_at ? localInputToIso(form.due_at) : null,
        vet_name: form.vet_name || null,
        clinic_name: form.clinic_name || null,
        description: form.description || null,
        reminder_days_before: Number(form.reminder_days_before),
      });
      setOpen(false);
      setForm({ ...form, title: "", due_at: "" });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the record.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmComplete(event: FormEvent) {
    event.preventDefault();
    if (!completing) return;
    setSaving(true);
    try {
      await api.vet.complete(completing.id, {
        next_due_at: followUp ? localInputToIso(followUp) : undefined,
      });
      setCompleting(null);
      setFollowUp("");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not complete that.");
    } finally {
      setSaving(false);
    }
  }

  function openComplete(record: VetRecord) {
    setCompleting(record);
    // Vaccinations are usually annual — pre-fill next year to save a step.
    if (record.record_type === "vaccination" && record.due_at) {
      const next = new Date(record.due_at);
      next.setFullYear(next.getFullYear() + 1);
      setFollowUp(isoToLocalInput(next.toISOString()));
    } else {
      setFollowUp("");
    }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Vet &amp; vaccinations"
        subtitle="Appointments, boosters and medication"
        action={
          <Button onClick={() => setOpen(true)} disabled={cats.length === 0}>
            New record
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <label className="mb-4 inline-flex items-center gap-2 text-sm text-ink/70">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(event) => setShowCompleted(event.target.checked)}
          className="h-4 w-4 rounded border-ink/25 text-moss-500 focus:ring-moss-500"
        />
        Include completed records
      </label>

      {records.length === 0 ? (
        <EmptyState
          title={showCompleted ? "No vet records yet." : "Nothing outstanding."}
          hint="Add an appointment or a vaccination due date to get reminders."
        />
      ) : (
        <ul className="grid gap-3 tablet:grid-cols-2">
          {records.map((record) => {
            const overdue =
              !record.completed_at &&
              record.due_at !== null &&
              new Date(record.due_at) < new Date();
            return (
              <li key={record.id}>
                <Card className="flex h-full flex-col justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-ink">{record.title}</p>
                      <Badge
                        tone={record.completed_at ? "done" : overdue ? "overdue" : "due"}
                      >
                        {record.completed_at ? "Done" : overdue ? "Overdue" : record.record_type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink/55">
                      {catNames[record.cat_id] ?? "Cat"}
                      {record.due_at && ` · due ${formatDate(record.due_at)}`}
                      {record.vet_name && ` · ${record.vet_name}`}
                    </p>
                    {record.description && (
                      <p className="mt-1 text-sm text-ink/60">{record.description}</p>
                    )}
                  </div>
                  {!record.completed_at && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => openComplete(record)}>
                        Mark done
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm(`Delete “${record.title}”?`)) return;
                          await api.vet.remove(record.id);
                          await load();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={open} title="New vet record" onClose={() => setOpen(false)}>
        <form onSubmit={createRecord} className="space-y-3">
          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="Cat">
              <Select
                required
                value={form.cat_id}
                onChange={(event) => setForm({ ...form, cat_id: event.target.value })}
              >
                <option value="">Choose a cat…</option>
                {cats.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select
                value={form.record_type}
                onChange={(event) =>
                  setForm({ ...form, record_type: event.target.value as VetRecordType })
                }
              >
                {RECORD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Title">
            <Input
              required
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Rabies booster"
            />
          </Field>

          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="Due" hint="A record needs a due date or a past date">
              <Input
                type="datetime-local"
                required
                value={form.due_at}
                onChange={(event) => setForm({ ...form, due_at: event.target.value })}
              />
            </Field>
            <Field label="Remind days before">
              <Input
                type="number"
                min="0"
                max="365"
                value={form.reminder_days_before}
                onChange={(event) =>
                  setForm({ ...form, reminder_days_before: Number(event.target.value) })
                }
              />
            </Field>
          </div>

          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="Vet">
              <Input
                value={form.vet_name}
                onChange={(event) => setForm({ ...form, vet_name: event.target.value })}
              />
            </Field>
            <Field label="Clinic">
              <Input
                value={form.clinic_name}
                onChange={(event) => setForm({ ...form, clinic_name: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create record"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={completing !== null}
        title={`Complete “${completing?.title ?? ""}”`}
        onClose={() => setCompleting(null)}
      >
        <form onSubmit={confirmComplete} className="space-y-3">
          <Field
            label="Book the follow-up"
            hint="Optional. Creates a new record so this one stays in the history."
          >
            <Input
              type="datetime-local"
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCompleting(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Mark done"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
