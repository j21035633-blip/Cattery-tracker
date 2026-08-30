import { Redirect } from "expo-router";

import { useAuth } from "@/lib/auth";
import { Loading, Screen } from "@/components/ui";

/** Entry gate: wait for the stored session, then route accordingly. */
export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Screen scroll={false}>
        <Loading label="Starting Cattery Tracker…" />
      </Screen>
    );
  }

  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}
