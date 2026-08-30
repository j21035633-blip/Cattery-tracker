import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ApiError, api } from "@/lib/api";
import { catAge } from "@/lib/format";
import type { Cat } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Grid,
  Input,
  Loading,
  PageHeader,
  Screen,
  Sheet,
} from "@/components/ui";
import { colors, spacing } from "@/theme";

const EMPTY = { name: "", breed: "", color: "", notes: "" };

export default function CatsScreen() {
  const router = useRouter();
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await api.cats.list({ limit: 200 });
      setCats(page.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load cats.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function create() {
    setSaving(true);
    try {
      await api.cats.create({
        name: form.name.trim(),
        breed: form.breed.trim() || null,
        color: form.color.trim() || null,
        notes: form.notes.trim() || null,
      });
      setForm(EMPTY);
      setSheetOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add the cat.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.moss500}
        />
      }
    >
      <PageHeader
        title="Cats"
        subtitle={`${cats.length} in your care`}
        action={<Button title="Add" size="sm" onPress={() => setSheetOpen(true)} />}
      />

      {error ? <ErrorNote message={error} /> : null}

      {cats.length === 0 ? (
        <EmptyState
          title="No cats yet."
          hint="Add a cat to start tracking feedings, cleaning and vet care."
        />
      ) : (
        <Grid>
          {cats.map((cat) => (
            <Pressable
              key={cat.id}
              accessibilityRole="button"
              onPress={() => router.push(`/cats/${cat.id}`)}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Card>
                <View style={styles.cardTop}>
                  <Text style={styles.name}>{cat.name}</Text>
                  {!cat.is_active ? <Badge>Retired</Badge> : null}
                </View>
                <Text style={styles.meta}>
                  {[cat.breed, cat.color, catAge(cat.date_of_birth)]
                    .filter(Boolean)
                    .join(" · ") || "No details yet"}
                </Text>
              </Card>
            </Pressable>
          ))}
        </Grid>
      )}

      <Sheet visible={sheetOpen} title="Add a cat" onClose={() => setSheetOpen(false)}>
        <Field label="Name">
          <Input
            value={form.name}
            onChangeText={(value) => setForm({ ...form, name: value })}
            placeholder="Biscuit"
          />
        </Field>
        <Field label="Breed">
          <Input
            value={form.breed}
            onChangeText={(value) => setForm({ ...form, breed: value })}
          />
        </Field>
        <Field label="Colour">
          <Input
            value={form.color}
            onChangeText={(value) => setForm({ ...form, color: value })}
          />
        </Field>
        <Field label="Notes">
          <Input
            value={form.notes}
            onChangeText={(value) => setForm({ ...form, notes: value })}
            multiline
          />
        </Field>
        <Button
          title={saving ? "Saving…" : "Add cat"}
          onPress={create}
          disabled={saving || !form.name.trim()}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  name: { fontSize: 18, fontWeight: "600", color: colors.ink, flexShrink: 1 },
  meta: { marginTop: 4, fontSize: 13, color: colors.inkMuted },
});
