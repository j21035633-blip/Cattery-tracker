import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { deviceTimezone } from "@/lib/format";
import { Button, Card, ErrorNote, Field, Input, Screen } from "@/components/ui";
import { colors, spacing } from "@/theme";

const PASSWORD_MIN_LENGTH = 10;

export default function SignupScreen() {
  const { signup } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit() {
    setError(null);

    // Mirror the API's rule locally so a weak password is caught before a
    // round trip on a mobile connection.
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (!form.phone.trim().startsWith("+")) {
      setError("Phone must be in international format, starting with +.");
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
        // Decides when the daily digest fires; changeable in settings.
        timezone: deviceTimezone(),
      });
      router.replace("/(tabs)");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not create the account.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen>
        <View style={styles.hero}>
          <Text style={styles.brand}>Create your account</Text>
          <Text style={styles.tagline}>Free while we are in early access.</Text>
        </View>

        <Card>
          <Field label="Name" hint="Optional">
            <Input
              value={form.full_name}
              onChangeText={(value) => update("full_name", value)}
              autoComplete="name"
              placeholder="Maya Okonkwo"
            />
          </Field>

          <Field label="Email">
            <Input
              value={form.email}
              onChangeText={(value) => update("email", value)}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@example.com"
            />
          </Field>

          <Field label="Phone" hint="International format, e.g. +14155552671">
            <Input
              value={form.phone}
              onChangeText={(value) => update("phone", value)}
              autoComplete="tel"
              keyboardType="phone-pad"
              placeholder="+14155552671"
            />
          </Field>

          <Field
            label="Password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters, mixing letters with numbers or symbols`}
          >
            <Input
              value={form.password}
              onChangeText={(value) => update("password", value)}
              secureTextEntry
              autoComplete="new-password"
            />
          </Field>

          {error ? <ErrorNote message={error} /> : null}

          <Button
            title={submitting ? "Creating account…" : "Create account"}
            onPress={onSubmit}
            disabled={submitting || !form.email || !form.phone || !form.password}
          />
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/login" style={styles.link}>
            Sign in
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing.xl, paddingBottom: spacing.lg, alignItems: "center" },
  brand: { fontSize: 26, fontWeight: "700", color: colors.ink },
  tagline: { marginTop: spacing.xs, fontSize: 14, color: colors.inkMuted },
  footer: {
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: { color: colors.inkMuted, fontSize: 14 },
  link: { color: colors.moss600, fontWeight: "600", fontSize: 14 },
});
