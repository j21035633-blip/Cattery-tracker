"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { TASK_LABELS, formatTime, humaniseMinutes } from "@/lib/format";
import type { DueItem, DueSummary } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api.due.summary());
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load today.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Complete straight from the dashboard — the common case is one tap. */
  async function complete(item: DueItem) {
    setBusyId(item.entity_id);
    try {
      if (item.task_type === "feeding") {
        await api.feeding.complete(item.entity_id);
      } else if (item.task_type === "cleaning") {
        await api.cleaning.complete(item.entity_id);
      } else {
        await api.vet.complete(item.entity_id);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update that.");
    } finally {
      setBusyId(null);
    }
  }

  async function generateToday() {
    setLoading(true);
    try {
      await api.feeding.generate({ days: 1 });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not build today's list.");
      setLoading(false);
    }
  }

  if (loading && !summary) return <Spinner label="Loading today…" />;

  const greeting = user?.full_name ? `Hello, ${user.full_name.split(" ")[0]}` : "Today";

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={
          summary
            ? `${new Date(summary.local_date).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })} · ${summary.timezone}`
            : undefined
        }
        action={
          <Button variant="secondary" size="sm" onClick={generateToday}>
            Build today&apos;s feedings
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {summary && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Stat label="Overdue" value={summary.counts.overdue} tone="overdue" />
            <Stat label="Due today" value={summary.counts.today} tone="due" />
            <Stat label="This week" value={summary.counts.upcoming} tone="neutral" />
          </div>

          <div className="space-y-5">
            <Section
              title="Overdue"
              items={summary.overdue}
              emptyHint="Nothing is late. "
              onComplete={complete}
              busyId={busyId}
              overdue
            />
            <Section
              title="Due today"
              items={summary.today}
              emptyHint="Nothing else scheduled today."
              onComplete={complete}
              busyId={busyId}
            />
            <Section
              title="This week"
              items={summary.upcoming}
              emptyHint="No vet or vaccination deadlines coming up."
              onComplete={complete}
              busyId={busyId}
              showDate
            />
          </div>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "overdue" | "due" | "neutral";
}) {
  const tones = {
    overdue: "text-clay-600",
    due: "text-amber-600",
    neutral: "text-ink/70",
  } as const;
  return (
    <Card className="text-center">
      <p className={`text-2xl font-semibold tablet:text-3xl ${tones[tone]}`}>{value}</p>
      <p className="mt-0.5 text-xs text-ink/55 tablet:text-sm">{label}</p>
    </Card>
  );
}

function Section({
  title,
  items,
  emptyHint,
  onComplete,
  busyId,
  overdue = false,
  showDate = false,
}: {
  title: string;
  items: DueItem[];
  emptyHint: string;
  onComplete: (item: DueItem) => void;
  busyId: string | null;
  overdue?: boolean;
  showDate?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">
        {title}
      </h2>
      {items.length === 0 ? (
        <EmptyState title={emptyHint} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.task_type}-${item.entity_id}`}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{item.title}</p>
                    <Badge tone={overdue ? "overdue" : "neutral"}>
                      {TASK_LABELS[item.task_type]}
                    </Badge>
                    {item.breaches_threshold && <Badge tone="overdue">Alerted</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink/55">
                    {showDate
                      ? new Date(item.due_at).toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })
                      : formatTime(item.due_at)}
                    {item.cat_name && ` · ${item.cat_name}`}
                    {overdue && ` · ${humaniseMinutes(item.overdue_by_minutes)} late`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={overdue ? "primary" : "secondary"}
                  disabled={busyId === item.entity_id}
                  onClick={() => onComplete(item)}
                >
                  {busyId === item.entity_id ? "Saving…" : "Mark done"}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
