"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { TASK_LABELS, humaniseMinutes, trimSeconds } from "@/lib/format";
import type { NotificationPreference, TaskType } from "@/lib/types";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";

/** Offered thresholds, in minutes. The API accepts anything from 5 to 20160. */
const THRESHOLD_CHOICES = [15, 30, 60, 120, 240, 360, 720, 1440, 2880];

export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    full_name: "",
    phone: "",
    timezone: "UTC",
    digest_time: "08:00",
    digest_enabled: true,
    push_enabled: true,
  });

  useEffect(() => {
    if (!user) return;
    setProfile({
      full_name: user.full_name ?? "",
      phone: user.phone,
      timezone: user.timezone,
      digest_time: trimSeconds(user.digest_time),
      digest_enabled: user.digest_enabled,
      push_enabled: user.push_enabled,
    });
    api.users
      .preferences()
      .then(setPreferences)
      .catch(() => setError("Could not load notification preferences."))
      .finally(() => setLoading(false));
  }, [user]);

  async function saveProfile() {
    setError(null);
    setStatus(null);
    try {
      await api.users.update({
        full_name: profile.full_name || null,
        phone: profile.phone,
        timezone: profile.timezone,
        digest_time: `${profile.digest_time}:00`,
        digest_enabled: profile.digest_enabled,
        push_enabled: profile.push_enabled,
      });
      await refreshUser();
      setStatus("Saved.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save settings.");
    }
  }

  async function updatePreference(
    taskType: TaskType,
    patch: Partial<NotificationPreference>,
  ) {
    setError(null);
    try {
      const updated = await api.users.updatePreference({ task_type: taskType, ...patch });
      setPreferences((current) =>
        current.map((item) => (item.task_type === taskType ? updated : item)),
      );
      setStatus("Saved.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save that.");
    }
  }

  if (!user || loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Settings" subtitle={user.email} />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {status && !error && (
        <p className="mb-4 rounded-xl bg-moss-50 px-3 py-2 text-sm text-moss-700">{status}</p>
      )}

      <div className="grid gap-4 desktop:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-ink">Profile</h2>
          <div className="space-y-3">
            <Field label="Name">
              <Input
                value={profile.full_name}
                onChange={(event) =>
                  setProfile({ ...profile, full_name: event.target.value })
                }
              />
            </Field>
            <Field label="Phone" hint="International format, e.g. +14155552671">
              <Input
                type="tel"
                value={profile.phone}
                onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
              />
            </Field>
            <Field label="Timezone" hint="Decides when your day starts and the digest fires">
              <Input
                value={profile.timezone}
                onChange={(event) =>
                  setProfile({ ...profile, timezone: event.target.value })
                }
                placeholder="Europe/Berlin"
                list="timezones"
              />
              <datalist id="timezones">
                {(Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
                  .supportedValuesOf?.("timeZone")
                  ?.map((zone) => <option key={zone} value={zone} />)}
              </datalist>
            </Field>
            <p className="text-xs text-ink/50">
              Plan: <span className="font-medium text-ink/70">{user.plan}</span> — everything
              is unlimited during early access.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold text-ink">Daily digest</h2>
          <div className="space-y-3">
            <Toggle
              label="Send a daily digest"
              checked={profile.digest_enabled}
              onChange={(checked) => setProfile({ ...profile, digest_enabled: checked })}
            />
            <Field label="Digest time" hint={`Local to ${profile.timezone}`}>
              <Input
                type="time"
                value={profile.digest_time}
                onChange={(event) =>
                  setProfile({ ...profile, digest_time: event.target.value })
                }
              />
            </Field>
            <Toggle
              label="Send push notifications"
              checked={profile.push_enabled}
              onChange={(checked) => setProfile({ ...profile, push_enabled: checked })}
            />
            <p className="text-xs text-ink/50">
              Push lands on the mobile app. The web app shows everything in the
              notification centre.
            </p>
          </div>
        </Card>

        <Card className="desktop:col-span-2">
          <h2 className="mb-1 font-semibold text-ink">Overdue alerts</h2>
          <p className="mb-3 text-sm text-ink/55">
            How late something has to be before it raises an alert. Set per task type.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink/45">
                  <th className="pb-2 font-medium">Task</th>
                  <th className="pb-2 font-medium">Alert after</th>
                  <th className="pb-2 text-center font-medium">In app</th>
                  <th className="pb-2 text-center font-medium">Push</th>
                  <th className="pb-2 text-center font-medium">In digest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {preferences.map((preference) => (
                  <tr key={preference.task_type}>
                    <td className="py-2 font-medium text-ink">
                      {TASK_LABELS[preference.task_type]}
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={preference.overdue_threshold_minutes}
                        onChange={(event) =>
                          updatePreference(preference.task_type, {
                            overdue_threshold_minutes: Number(event.target.value),
                          })
                        }
                        className="max-w-[10rem] py-1.5"
                      >
                        {[
                          ...new Set([
                            ...THRESHOLD_CHOICES,
                            preference.overdue_threshold_minutes,
                          ]),
                        ]
                          .sort((a, b) => a - b)
                          .map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {humaniseMinutes(minutes)}
                            </option>
                          ))}
                      </Select>
                    </td>
                    <CheckCell
                      checked={preference.in_app_enabled}
                      onChange={(checked) =>
                        updatePreference(preference.task_type, { in_app_enabled: checked })
                      }
                    />
                    <CheckCell
                      checked={preference.push_enabled}
                      onChange={(checked) =>
                        updatePreference(preference.task_type, { push_enabled: checked })
                      }
                    />
                    <CheckCell
                      checked={preference.include_in_digest}
                      onChange={(checked) =>
                        updatePreference(preference.task_type, {
                          include_in_digest: checked,
                        })
                      }
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={saveProfile}>Save settings</Button>
        <Button variant="ghost" onClick={logout}>
          Sign out
        </Button>
      </div>
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink/80">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-ink/25 text-moss-500 focus:ring-moss-500"
      />
      {label}
    </label>
  );
}

function CheckCell({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <td className="py-2 text-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-ink/25 text-moss-500 focus:ring-moss-500"
      />
    </td>
  );
}
