"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiError, api } from "@/lib/api";
import { formatDateTime, humaniseMinutes, relativeToNow } from "@/lib/format";
import type { CleaningTask } from "@/lib/types";
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
} from "@/components/ui";

const INTERVAL_PRESETS = [
  { label: "Twice a day", hours: 12 },
  { label: "Daily", hours: 24 },
  { label: "Every 2 days", hours: 48 },
  { label: "Weekly", hours: 168 },
  { label: "Fortnightly", hours: 336 },
];

export default function CleaningPage() {
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "Scoop litter",
    zone: "",
    interval_hours: 24,
    rotation_order: 0,
  });

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
  }, [load]);

  // Grouped by zone so the rotation is visible at a glance, which is the point
  // of the zone field.
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

  async function createTask(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.cleaning.createTask({
        name: form.name,
        zone: form.zone,
        interval_hours: Number(form.interval_hours),
        rotation_order: Number(form.rotation_order),
      });
      setOpen(false);
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

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Cleaning"
        subtitle="Litter and cleaning rotation by zone"
        action={<Button onClick={() => setOpen(true)}>New task</Button>}
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState
          title="No cleaning tasks yet."
          hint="Add one per zone — a litter box, a room, a pen — and the rotation takes care of itself."
          action={<Button onClick={() => setOpen(true)}>New task</Button>}
        />
      ) : (
        <div className="space-y-5">
          {byZone.map(([zone, zoneTasks]) => (
            <section key={zone}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">
                {zone}
              </h2>
              <ul className="grid gap-3 tablet:grid-cols-2">
                {zoneTasks.map((task) => {
                  const overdueMinutes = Math.round(
                    (Date.now() - new Date(task.next_due_at).getTime()) / 60000,
                  );
                  const isOverdue = overdueMinutes > 0;
                  return (
                    <li key={task.id}>
                      <Card className="flex h-full flex-col justify-between gap-3">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-ink">{task.name}</p>
                            <Badge tone={isOverdue ? "overdue" : "done"}>
                              {isOverdue
                                ? `${humaniseMinutes(overdueMinutes)} late`
                                : "On track"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-ink/55">
                            Due {formatDateTime(task.next_due_at)} · every{" "}
                            {humaniseMinutes(task.interval_hours * 60)}
                          </p>
                          {task.last_completed_at && (
                            <p className="mt-0.5 text-xs text-ink/45">
                              Last done {relativeToNow(task.last_completed_at)}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busyId === task.id}
                            onClick={() => complete(task.id)}
                          >
                            {busyId === task.id ? "Saving…" : "Mark cleaned"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (!window.confirm(`Delete “${task.name}”?`)) return;
                              await api.cleaning.removeTask(task.id);
                              await load();
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Modal open={open} title="New cleaning task" onClose={() => setOpen(false)}>
        <form onSubmit={createTask} className="space-y-3">
          <Field label="Task">
            <Input
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Scoop litter"
            />
          </Field>
          <Field label="Zone" hint="Litter box, room or pen this covers">
            <Input
              required
              value={form.zone}
              onChange={(event) => setForm({ ...form, zone: event.target.value })}
              placeholder="Main room"
              list="known-zones"
            />
            <datalist id="known-zones">
              {[...new Set(tasks.map((task) => task.zone))].map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </Field>
          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="How often">
              <Select
                value={form.interval_hours}
                onChange={(event) =>
                  setForm({ ...form, interval_hours: Number(event.target.value) })
                }
              >
                {INTERVAL_PRESETS.map((preset) => (
                  <option key={preset.hours} value={preset.hours}>
                    {preset.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rotation order" hint="Lower numbers come first in the zone">
              <Input
                type="number"
                min="0"
                value={form.rotation_order}
                onChange={(event) =>
                  setForm({ ...form, rotation_order: Number(event.target.value) })
                }
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create task"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
