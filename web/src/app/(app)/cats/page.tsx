"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

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
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

const EMPTY_FORM = {
  name: "",
  breed: "",
  color: "",
  sex: "unknown",
  date_of_birth: "",
  microchip_id: "",
  notes: "",
};

export default function CatsPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await api.cats.list({ search: search || undefined, limit: 200 });
      setCats(page.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load cats.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.cats.create({
        name: form.name,
        breed: form.breed || null,
        color: form.color || null,
        sex: form.sex as Cat["sex"],
        date_of_birth: form.date_of_birth || null,
        microchip_id: form.microchip_id || null,
        notes: form.notes || null,
      });
      setForm(EMPTY_FORM);
      setOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add the cat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Cats"
        subtitle={`${cats.length} in your care`}
        action={<Button onClick={() => setOpen(true)}>Add a cat</Button>}
      />

      <div className="mb-4">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          aria-label="Search cats"
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : cats.length === 0 ? (
        <EmptyState
          title={search ? "No cats match that search." : "No cats yet."}
          hint="Add a cat to start tracking feedings, cleaning and vet care."
          action={<Button onClick={() => setOpen(true)}>Add a cat</Button>}
        />
      ) : (
        <ul className="grid gap-3 tablet:grid-cols-2 desktop:grid-cols-3">
          {cats.map((cat) => (
            <li key={cat.id}>
              <Link href={`/cats/${cat.id}`} className="block">
                <Card className="h-full transition hover:border-moss-500/40 hover:shadow">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-lg font-semibold text-ink">{cat.name}</p>
                    {!cat.is_active && <Badge>Retired</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-ink/55">
                    {[cat.breed, cat.color, catAge(cat.date_of_birth)]
                      .filter(Boolean)
                      .join(" · ") || "No details yet"}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} title="Add a cat" onClose={() => setOpen(false)}>
        <form onSubmit={onCreate} className="space-y-3">
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Biscuit"
            />
          </Field>
          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="Breed">
              <Input
                value={form.breed}
                onChange={(event) => setForm({ ...form, breed: event.target.value })}
              />
            </Field>
            <Field label="Colour">
              <Input
                value={form.color}
                onChange={(event) => setForm({ ...form, color: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-3 tablet:grid-cols-2">
            <Field label="Sex">
              <Select
                value={form.sex}
                onChange={(event) => setForm({ ...form, sex: event.target.value })}
              >
                <option value="unknown">Unknown</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </Field>
            <Field label="Date of birth">
              <Input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.date_of_birth}
                onChange={(event) =>
                  setForm({ ...form, date_of_birth: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Microchip ID">
            <Input
              value={form.microchip_id}
              onChange={(event) => setForm({ ...form, microchip_id: event.target.value })}
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add cat"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
