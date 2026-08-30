import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResponsive } from "@/lib/responsive";
import { Button, Card, ErrorNote, Field, Input, Screen } from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const { isTablet } = useResponsive();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in.");
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
        <View style={[styles.hero, isTablet && styles.heroTablet]}>
          <Text style={styles.brand}>Cattery Tracker</Text>
          <Text style={styles.tagline}>
            Feeding, cleaning and vet care for every cat in your care.
          </Text>
        </View>

        <Card>
          <Field label="Email">
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@example.com"
              returnKeyType="next"
            />
          </Field>

          <Field label="Password">
            <Input
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />
          </Field>

          {error ? <ErrorNote message={error} /> : null}

          <Button
            title={submitting ? "Signing in…" : "Sign in"}
            onPress={onSubmit}
            disabled={submitting || !email || !password}
          />
        </Card>

        <View style={styles.footer}>
          <Text style={styles.footerText}>No account yet? </Text>
          <Link href="/signup" style={styles.link}>
            Create one
          </Link>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing.xxl, paddingBottom: spacing.xl, alignItems: "center" },
  heroTablet: { paddingTop: 72 },
  brand: { fontSize: 28, fontWeight: "700", color: colors.ink },
  tagline: {
    marginTop: spacing.sm,
    fontSize: 15,
    color: colors.inkMuted,
    textAlign: "center",
    maxWidth: 320,
  },
  footer: {
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: { color: colors.inkMuted, fontSize: 14 },
  link: { color: colors.moss600, fontWeight: "600", fontSize: 14 },
});
