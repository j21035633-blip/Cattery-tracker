import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, api, tokens } from "./api";
import { registerForPush } from "./push";
import type { User } from "./types";

/** Why push is not active, so the settings screen can word it appropriately. */
export type PushStatusKind = "ok" | "expo-go" | "denied" | "unsupported";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Set when push registration could not complete, for the settings screen. */
  pushStatus: string | null;
  pushStatusKind: PushStatusKind;
  login: (email: string, password: string) => Promise<void>;
  signup: (payload: {
    email: string;
    phone: string;
    password: string;
    full_name?: string;
    timezone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [pushStatusKind, setPushStatusKind] = useState<PushStatusKind>("ok");
  const router = useRouter();

  /**
   * Register for push after a session exists — the token is posted to
   * /devices, which needs the bearer token. Idempotent, so running it on every
   * sign-in and every cold start is fine and keeps `last_seen_at` fresh.
   */
  const syncPushToken = useCallback(async () => {
    const result = await registerForPush();
    switch (result.status) {
      case "registered":
        setPushStatusKind("ok");
        setPushStatus(null);
        break;
      case "skipped":
        // Expo Go. Expected while previewing, so it is reported as information
        // rather than as something the user should go and fix.
        setPushStatusKind("expo-go");
        setPushStatus(result.reason);
        break;
      case "denied":
        setPushStatusKind("denied");
        setPushStatus(
          "Notifications are turned off for this app. Enable them in system settings to get alerts.",
        );
        break;
      default:
        setPushStatusKind("unsupported");
        setPushStatus(result.reason);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const hasTokens = await tokens.hydrate();
      if (!hasTokens) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const me = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        void syncPushToken();
      } catch (error) {
        // Only clear on a real auth rejection — a dead network on a train
        // should not sign the user out.
        if (error instanceof ApiError && error.isAuthError) await tokens.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [syncPushToken]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.auth.login({ email, password });
      await tokens.save(response.access_token, response.refresh_token);
      setUser(response.user);
      void syncPushToken();
    },
    [syncPushToken],
  );

  const signup = useCallback(
    async (payload: {
      email: string;
      phone: string;
      password: string;
      full_name?: string;
      timezone?: string;
    }) => {
      const response = await api.auth.signup(payload);
      await tokens.save(response.access_token, response.refresh_token);
      setUser(response.user);
      void syncPushToken();
    },
    [syncPushToken],
  );

  const logout = useCallback(async () => {
    // Drop this device's push registration first, while the token still works,
    // so the next owner of the phone does not receive this account's alerts.
    try {
      const devices = await api.devices.list();
      await Promise.all(devices.map((device) => api.devices.remove(device.id)));
    } catch {
      /* best effort */
    }
    try {
      await api.auth.logout(tokens.refresh());
    } catch {
      /* signing out locally must always succeed */
    }
    await tokens.clear();
    setUser(null);
    router.replace("/login");
  }, [router]);

  const refreshUser = useCallback(async () => {
    setUser(await api.auth.me());
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      pushStatus,
      pushStatusKind,
      login,
      signup,
      logout,
      refreshUser,
    }),
    [user, loading, pushStatus, pushStatusKind, login, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
