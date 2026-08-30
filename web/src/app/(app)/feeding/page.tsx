"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiError, api } from "@/lib/api";
import { WEEKDAYS, describeDays, formatTime, trimSeconds } from "@/lib/format";
import type { Cat, FeedingEvent, FeedingSchedule } from "@/lib/types";
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
  cx,
} from "@/components/ui";

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export default function FeedingPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [schedules, setSchedules] = useState<FeedingSchedule[]>([]);
  const [events, setEvents] = useState<FeedingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState({
    cat_id: "",
    label: "Breakfast",
    scheduled_time: "07:30",
    days: [...ALL_DAYS],
    food_type: "",
    portion_amount: "",
    portion_unit: "g",
  });

  const catNames = useMemo(
    () => Object.fromEntries(cats.map((cat) => [cat.id, cat.name])),
    [cats],
  );

  const load = useCallback(async () => {
    try {
      // Today in the browser's zone; the API filters on the instants we send.
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
  }, [load]);

  function toggleDay(day: number) {
    setForm((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((value) => value !== day)
        : [...current.days, day].sort((a, b) => a - b),
    }));
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    if (form.days.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    setSaving(true);
    try {
      await api.feeding.createSchedule({
        cat_id: form.cat_id,
        label: form.label,
        // The API takes HH:MM:SS.
        scheduled_time: `${form.scheduled_time}:00`,
        days_of_week: form.days,
        food_type: form.food_type || null,
        portion_amount: form.portion_amount || null,
        portion_unit: form.portion_unit || null,
      });
      setOpen(false);
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

  async function generate() {
    try {
      await api.feeding.generate({ days: 1 });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not build today's list.");
    }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Feeding"
        subtitle="Schedules and today's feedings"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={generate}>
              Build today
            </Button>
            <Button size="sm" onClick={() => setOpen(true)} disabled={cats.length === 0}>
              New schedule
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {cats.length === 0 && (
        <div className="mb-4">
          <EmptyState
            title="Add a cat first."
            hint="Feeding schedules belong to a cat."
          />
        </div>
      )}

      <div className="grid gap-4 desktop:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-ink">Today</h2>
          {events.length === 0 ? (
            <EmptyState
              title="Nothing scheduled for today yet."
              hint="Use “Build today” to create today's feedings from the schedules."
            />
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream px-3 py-2"
                >
                  <div>
                    <p className="font-medium text-ink">
                      {catNames[event.cat_id] ?? "Cat"}
                    </p>
                    <p className="text-sm text-ink/55">{formatTime(event.due_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={event.status} />
                    {event.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          disabled={busyId === event.id}
                          onClick={() => act(event.id, "complete")}
                        >
                          Fed
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === event.id}
                          onClick={() => act(event.id, "skip")}
                        >
                          Skip
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold text-ink">Schedules</h2>
          {schedules.length === 0 ? (
            <EmptyState title="No schedules yet." />
          ) : (
            <ul className="space-y-2">
              {schedules.map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream px-3 py-2"
                >
                  <div>
                    <p className="font-medium text-ink">
                      {schedule.label} · {catNames[schedule.cat_id] ?? "Cat"}
                    </p>
                    <p className="text-sm text-ink/55">
                      {trimSeconds(schedule.scheduled_time)} ·{" "}
                      {describeDays(schedule.days_of_week)}
                      {schedule.portion_amount &&
                        ` · ${Number(schedule.portion_amount)}${schedule.portion_unit ?? ""}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!schedule.is_active && <Badge>Paused</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api.feeding.updateSchedule(schedule.id, {
                          is_active: !schedule.is_active,
                        });
                        await load();
                      }}
                    >
                      {schedule.is_active ? "Pause" : "Resume"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={open} title="New feeding schedule" onClose={() => setOpen(false)}>
        <form onSubmit={createSchedule} className="space-y-3">
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

          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="Label">
              <Input
                required
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </Field>
            <Field label="Time">
              <Input
                type="time"
                required
                value={form.scheduled_time}
                onChange={(event) =>
                  setForm({ ...form, scheduled_time: event.target.value })
                }
              />
            </Field>
          </div>

          <Field label="Days" hint={describeDays(form.days)}>
            <div className="flex flex-wrap gap-1.5">
              {ALL_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={form.days.includes(day)}
                  className={cx(
                    "rounded-lg px-3 py-2 text-sm font-medium transition",
                    form.days.includes(day)
                      ? "bg-moss-500 text-white"
                      : "bg-black/5 text-ink/60 hover:bg-black/10",
                  )}
                >
                  {WEEKDAYS[day]}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-3 tablet:grid-cols-3">
            <Field label="Food">
              <Input
                value={form.food_type}
                onChange={(event) => setForm({ ...form, food_type: event.target.value })}
                placeholder="Wet, chicken"
              />
            </Field>
            <Field label="Portion">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.portion_amount}
                onChange={(event) =>
                  setForm({ ...form, portion_amount: event.target.value })
                }
                placeholder="60"
              />
            </Field>
            <Field label="Unit">
              <Input
                value={form.portion_unit}
                onChange={(event) => setForm({ ...form, portion_unit: event.target.value })}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create schedule"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function StatusBadge({ status }: { status: FeedingEvent["status"] }) {
  const tone =
    status === "completed" ? "done" : status === "missed" ? "overdue" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
