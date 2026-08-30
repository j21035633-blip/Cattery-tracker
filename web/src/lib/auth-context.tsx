"use client";

import { useRouter } from "next/navigation";
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
import type { User } from "./types";

interface AuthState {
  user: User | null;
  /** True until the stored token has been checked on first paint. */
  loading: boolean;
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
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Restore the session from the stored token on first mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tokens.access() && !tokens.refresh()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.auth.me();
        if (!cancelled) setUser(me);
      } catch (error) {
        // An expired or revoked session is not an error worth showing.
        if (error instanceof ApiError && error.isAuthError) tokens.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.auth.login({ email, password });
    tokens.save(response.access_token, response.refresh_token);
    setUser(response.user);
  }, []);

  const signup = useCallback(
    async (payload: {
      email: string;
      phone: string;
      password: string;
      full_name?: string;
      timezone?: string;
    }) => {
      const response = await api.auth.signup(payload);
      tokens.save(response.access_token, response.refresh_token);
      setUser(response.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout(tokens.refresh());
    } catch {
      // Signing out locally must succeed even if the server call does not.
    }
    tokens.clear();
    setUser(null);
    router.push("/login");
  }, [router]);

  const refreshUser = useCallback(async () => {
    setUser(await api.auth.me());
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, signup, logout, refreshUser, setUser }),
    [user, loading, login, signup, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
