"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

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
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";

export default function CatDetailPage() {
  const { catId } = useParams<{ catId: string }>();
  const router = useRouter();

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

  async function addWeight(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      // The API stores grams; the form asks for kg because that is what scales show.
      await api.weight.create({
        cat_id: catId,
        weight_grams: Math.round(Number(weightKg) * 1000),
      });
      setWeightKg("");
      setWeighOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the weight.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCat() {
    if (
      !window.confirm(
        `Delete ${cat?.name}? Their schedules, vet records and weight history go too. ` +
          "To keep the history, mark them retired instead.",
      )
    ) {
      return;
    }
    try {
      await api.cats.remove(catId);
      router.push("/cats");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete the cat.");
    }
  }

  async function toggleRetired() {
    if (!cat) return;
    try {
      setCat(await api.cats.update(catId, { is_active: !cat.is_active }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update the cat.");
    }
  }

  if (loading) return <Spinner />;
  if (!cat) return <ErrorNote message={error ?? "Cat not found."} />;

  return (
    <>
      <PageHeader
        title={cat.name}
        subtitle={
          [cat.breed, cat.color, catAge(cat.date_of_birth)].filter(Boolean).join(" · ") ||
          undefined
        }
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={toggleRetired}>
              {cat.is_active ? "Mark retired" : "Mark active"}
            </Button>
            <Button variant="ghost" size="sm" onClick={removeCat}>
              Delete
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="grid gap-4 desktop:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink">Weight</h2>
            <Button size="sm" variant="secondary" onClick={() => setWeighOpen(true)}>
              Log weight
            </Button>
          </div>

          {trend && trend.samples > 0 && (
            <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="Latest" value={formatWeight(trend.latest_grams)} />
              <Metric label="Change" value={formatWeightDelta(trend.change_grams)} />
              <Metric label="Readings" value={String(trend.samples)} />
            </dl>
          )}

          <WeightChart logs={weights} />
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink">Feeding schedules</h2>
            <Link href="/feeding" className="text-sm font-medium text-moss-600 hover:underline">
              Manage
            </Link>
          </div>
          {schedules.length === 0 ? (
            <EmptyState title="No feeding schedule yet." />
          ) : (
            <ul className="space-y-2">
              {schedules.map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex items-center justify-between rounded-xl bg-cream px-3 py-2"
                >
                  <div>
                    <p className="font-medium text-ink">{schedule.label}</p>
                    <p className="text-sm text-ink/55">
                      {trimSeconds(schedule.scheduled_time)} ·{" "}
                      {describeDays(schedule.days_of_week)}
                    </p>
                  </div>
                  {!schedule.is_active && <Badge>Paused</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="desktop:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink">Vet &amp; vaccinations</h2>
            <Link href="/vet" className="text-sm font-medium text-moss-600 hover:underline">
              Manage
            </Link>
          </div>
          {records.length === 0 ? (
            <EmptyState title="No vet records yet." />
          ) : (
            <ul className="divide-y divide-black/5">
              {records.map((record) => (
                <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium text-ink">{record.title}</p>
                    <p className="text-sm text-ink/55">
                      {record.record_type}
                      {record.due_at && ` · due ${formatDate(record.due_at)}`}
                      {record.vet_name && ` · ${record.vet_name}`}
                    </p>
                  </div>
                  <Badge tone={record.completed_at ? "done" : "due"}>
                    {record.completed_at ? "Done" : "Outstanding"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {cat.notes && (
          <Card className="desktop:col-span-2">
            <h2 className="mb-2 font-semibold text-ink">Notes</h2>
            <p className="whitespace-pre-wrap text-sm text-ink/70">{cat.notes}</p>
          </Card>
        )}
      </div>

      <Modal open={weighOpen} title={`Log weight for ${cat.name}`} onClose={() => setWeighOpen(false)}>
        <form onSubmit={addWeight} className="space-y-3">
          <Field label="Weight (kg)" hint="Between 0.10 and 40.00 kg">
            <Input
              type="number"
              step="0.01"
              min="0.1"
              max="40"
              required
              value={weightKg}
              onChange={(event) => setWeightKg(event.target.value)}
              placeholder="4.20"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setWeighOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-cream px-2 py-2">
      <dt className="text-xs text-ink/50">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}
