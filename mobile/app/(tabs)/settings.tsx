import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TASK_LABELS, humaniseMinutes, normaliseTimeInput, trimSeconds } from "@/lib/format";
import type { NotificationPreference, TaskType } from "@/lib/types";
import {
  Button,
  Card,
  ChipGroup,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Screen,
  SectionTitle,
  Switch,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

/** Offered thresholds in minutes; the API accepts 5 to 20160. */
const THRESHOLDS = [15, 30, 60, 120, 240, 360, 720, 1440];

export default function SettingsScreen() {
  const { user, refreshUser, logout, pushStatus, pushStatusKind } = useAuth();
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

  async function save() {
    const digestTime = normaliseTimeInput(profile.digest_time);
    if (!digestTime) {
      setError("Digest time must look like 08:00.");
      return;
    }

    setError(null);
    setStatus(null);
    try {
      await api.users.update({
        full_name: profile.full_name.trim() || null,
        phone: profile.phone.trim(),
        timezone: profile.timezone.trim(),
        digest_time: digestTime,
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

  if (!user || loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Settings" subtitle={user.email} />

      {error ? <ErrorNote message={error} /> : null}
      {status && !error ? <Text style={styles.status}>{status}</Text> : null}

      {pushStatus ? (
        <Card
          style={
            pushStatusKind === "expo-go" ? styles.pushNotice : styles.pushWarning
          }
        >
          <Text
            style={
              pushStatusKind === "expo-go" ? styles.noticeTitle : styles.pushTitle
            }
          >
            {pushStatusKind === "expo-go"
              ? "Push is off in Expo Go"
              : "Push notifications are not active"}
          </Text>
          <Text style={styles.pushBody}>{pushStatus}</Text>
          {/* Only the denied case can be fixed in system settings; sending the
              user there for Expo Go or a missing project id would be a dead end. */}
          {pushStatusKind === "denied" ? (
            <Button
              title="Open system settings"
              variant="secondary"
              size="sm"
              onPress={() => void Linking.openSettings()}
              style={{ marginTop: spacing.md, alignSelf: "flex-start" }}
            />
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>Profile</SectionTitle>
      <Card>
        <Field label="Name">
          <Input
            value={profile.full_name}
            onChangeText={(value) => setProfile({ ...profile, full_name: value })}
          />
        </Field>
        <Field label="Phone" hint="International format, e.g. +14155552671">
          <Input
            value={profile.phone}
            onChangeText={(value) => setProfile({ ...profile, phone: value })}
            keyboardType="phone-pad"
          />
        </Field>
        <Field label="Timezone" hint="Decides when your day starts and the digest fires">
          <Input
            value={profile.timezone}
            onChangeText={(value) => setProfile({ ...profile, timezone: value })}
            autoCapitalize="none"
            placeholder="Europe/Berlin"
          />
        </Field>
        <Text style={styles.planNote}>
          Plan: {user.plan} — everything is unlimited during early access.
        </Text>
      </Card>

      <SectionTitle>Daily digest</SectionTitle>
      <Card>
        <Switch
          label="Send a daily digest"
          value={profile.digest_enabled}
          onChange={(value) => setProfile({ ...profile, digest_enabled: value })}
        />
        <View style={{ height: spacing.md }} />
        <Field label="Digest time" hint={`Local to ${profile.timezone}`}>
          <Input
            value={profile.digest_time}
            onChangeText={(value) => setProfile({ ...profile, digest_time: value })}
            keyboardType="numbers-and-punctuation"
            placeholder="08:00"
          />
        </Field>
        <Switch
          label="Send push notifications"
          value={profile.push_enabled}
          onChange={(value) => setProfile({ ...profile, push_enabled: value })}
        />
      </Card>

      <SectionTitle>Overdue alerts</SectionTitle>
      <Text style={styles.hint}>
        How late something has to be before it raises an alert. Saved as you change them.
      </Text>
      {preferences.map((preference) => (
        <Card key={preference.task_type} style={styles.prefCard}>
          <Text style={styles.prefTitle}>{TASK_LABELS[preference.task_type]}</Text>
          <Text style={styles.prefValue}>
            Alerts after {humaniseMinutes(preference.overdue_threshold_minutes)}
          </Text>
          <View style={{ marginTop: spacing.sm }}>
            <ChipGroup
              options={[
                ...new Set([...THRESHOLDS, preference.overdue_threshold_minutes]),
              ]
                .sort((a, b) => a - b)
                .map((minutes) => ({ label: humaniseMinutes(minutes), value: minutes }))}
              value={preference.overdue_threshold_minutes}
              onChange={(minutes) =>
                updatePreference(preference.task_type, {
                  overdue_threshold_minutes: minutes,
                })
              }
            />
          </View>
          <View style={styles.prefToggles}>
            <Switch
              label="In app"
              value={preference.in_app_enabled}
              onChange={(value) =>
                updatePreference(preference.task_type, { in_app_enabled: value })
              }
            />
            <Switch
              label="Push"
              value={preference.push_enabled}
              onChange={(value) =>
                updatePreference(preference.task_type, { push_enabled: value })
              }
            />
            <Switch
              label="In digest"
              value={preference.include_in_digest}
              onChange={(value) =>
                updatePreference(preference.task_type, { include_in_digest: value })
              }
            />
          </View>
        </Card>
      ))}

      <View style={styles.footer}>
        <Button title="Save settings" onPress={save} />
        <Button title="Sign out" variant="ghost" onPress={() => void logout()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: {
    backgroundColor: colors.moss50,
    color: colors.moss700,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    fontSize: 14,
  },
  pushWarning: { backgroundColor: colors.amber100, borderColor: "#d99b3240" },
  pushTitle: { fontWeight: "600", color: colors.amber600 },
  pushNotice: { backgroundColor: colors.moss50, borderColor: "#4a7c5933" },
  noticeTitle: { fontWeight: "600", color: colors.moss700 },
  pushBody: { marginTop: 4, fontSize: 13, color: colors.inkMuted, lineHeight: 19 },

  planNote: { fontSize: 12, color: colors.inkFaint },
  hint: { fontSize: 13, color: colors.inkMuted, marginBottom: spacing.sm },

  prefCard: { marginBottom: spacing.sm },
  prefTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  prefValue: { marginTop: 2, fontSize: 13, color: colors.inkMuted },
  prefToggles: { marginTop: spacing.sm, gap: spacing.xs },

  footer: { marginTop: spacing.xl, gap: spacing.sm },
});
