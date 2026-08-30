"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { TASK_LABELS, relativeToNow } from "@/lib/format";
import type { AppNotification, DigestPreview } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  cx,
} from "@/components/ui";

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [page, digest] = await Promise.all([
        api.notifications.list({ unread_only: unreadOnly || undefined, limit: 100 }),
        api.due.digestPreview(),
      ]);
      setItems(page.items);
      setPreview(digest);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not load notifications.",
      );
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleRead(notification: AppNotification) {
    try {
      if (notification.is_read) await api.notifications.markUnread(notification.id);
      else await api.notifications.markRead(notification.id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update that.");
    }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Daily digest and overdue alerts"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await api.notifications.readAll();
              await load();
            }}
          >
            Mark all read
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {preview && (
        <Card className="mb-5 border-moss-500/20 bg-moss-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-moss-700">
                Today&apos;s digest preview
              </p>
              <p className="mt-1 font-medium text-ink">{preview.title}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-ink/70">
                {preview.body}
              </pre>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await api.due.sendDigest();
                await load();
              }}
            >
              Send now
            </Button>
          </div>
        </Card>
      )}

      <label className="mb-4 inline-flex items-center gap-2 text-sm text-ink/70">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(event) => setUnreadOnly(event.target.checked)}
          className="h-4 w-4 rounded border-ink/25 text-moss-500 focus:ring-moss-500"
        />
        Unread only
      </label>

      {items.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "Nothing unread." : "No notifications yet."}
          hint="The daily digest arrives at your chosen time, and overdue alerts appear as tasks pass their threshold."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((notification) => (
            <li key={notification.id}>
              <Card
                className={cx(
                  "flex flex-wrap items-start justify-between gap-3",
                  !notification.is_read && "border-l-4 border-l-moss-500",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{notification.title}</p>
                    <Badge tone={notification.type === "overdue" ? "overdue" : "neutral"}>
                      {notification.type === "daily_digest"
                        ? "Digest"
                        : notification.task_type
                          ? TASK_LABELS[notification.task_type]
                          : notification.type}
                    </Badge>
                    {notification.push_sent_at && <Badge tone="done">Pushed</Badge>}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-ink/65">
                    {notification.body}
                  </pre>
                  <p className="mt-1 text-xs text-ink/45">
                    {relativeToNow(notification.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toggleRead(notification)}>
                    {notification.is_read ? "Unread" : "Read"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.notifications.remove(notification.id);
                      await load();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
