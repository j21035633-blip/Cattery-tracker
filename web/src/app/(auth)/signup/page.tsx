"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { browserTimezone } from "@/lib/format";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

const PASSWORD_MIN_LENGTH = 10;

export default function SignupPage() {
  const { signup, user, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Mirror the API's rule so the user is not bounced by a round trip.
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email: form.email,
        phone: form.phone,
        password: form.password,
        full_name: form.full_name || undefined,
        // The digest fires at 08:00 in this zone unless changed in settings.
        timezone: browserTimezone(),
      });
      router.push("/dashboard");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create the account. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold text-ink">Create your account</h1>
          <p className="mt-1 text-sm text-ink/60">Free while we are in early access.</p>
        </div>

        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Name" hint="Optional">
              <Input
                autoComplete="name"
                value={form.full_name}
                onChange={(event) => update("full_name", event.target.value)}
                placeholder="Maya Okonkwo"
              />
            </Field>

            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="you@example.com"
              />
            </Field>

            <Field label="Phone" hint="International format, e.g. +14155552671">
              <Input
                type="tel"
                autoComplete="tel"
                required
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="+14155552671"
              />
            </Field>

            <Field
              label="Password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters, mixing letters with numbers or symbols`}
            >
              <Input
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
              />
            </Field>

            {error && <ErrorNote message={error} />}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-ink/60">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-moss-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
