/**
 * Typed API client for the mobile app.
 *
 * Same contract as the web client, with two differences that matter on device:
 *
 * - Tokens live in SecureStore, which is async, so they are cached in memory
 *   after the first read and written through on change.
 * - Requests carry a timeout. A phone on a flaky connection otherwise leaves
 *   a fetch hanging indefinitely and the screen stuck on its spinner.
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { deleteItem, getItem, setItem } from "./storage";
import type {
  AppNotification,
  AuthResponse,
  Cat,
  CleaningEvent,
  CleaningTask,
  DigestPreview,
  DueSummary,
  FeedingEvent,
  FeedingSchedule,
  NotificationPreference,
  Page,
  TokenPair,
  User,
  VetRecord,
  WeightLog,
  WeightTrend,
} from "./types";

/**
 * `localhost` written from the point of view of the machine running the API.
 * On a device or emulator it resolves to that device instead, which is why a
 * default of `http://localhost:8000` silently fails to connect.
 */
const LOOPBACK_HOST = /^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=[:/]|$)/i;

/** The Android emulator's built-in alias for the host machine's loopback. */
const ANDROID_EMULATOR_HOST = "10.0.2.2";

function resolveApiUrl(): string {
  const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  const raw = (
    process.env.EXPO_PUBLIC_API_URL ??
    fromExtra ??
    "http://localhost:8000"
  ).replace(/\/$/, "");

  // The Android emulator reaches the host through a fixed NAT alias: from
  // inside the VM, `localhost` is the emulator itself and 10.0.2.2 is the
  // machine running the API. Rewriting here rather than in .env keeps one
  // config working for the emulator, the iOS simulator and the web target at
  // once — and does not go stale when the laptop's LAN address changes.
  //
  // `Device.isDevice` is false only on an emulator/simulator, so a physical
  // Android phone (which needs a real LAN address) is left untouched.
  if (Platform.OS === "android" && !Device.isDevice) {
    return raw.replace(LOOPBACK_HOST, `$1${ANDROID_EMULATOR_HOST}`);
  }
  return raw;
}

export const API_URL = resolveApiUrl();
const PREFIX = "/api/v1";
const TIMEOUT_MS = 20_000;

const ACCESS_KEY = "cattery.access_token";
const REFRESH_KEY = "cattery.refresh_token";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True for the "no connection" case, which deserves different wording. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

// --- token cache ----------------------------------------------------------

let accessToken: string | null = null;
let refreshToken: string | null = null;
let hydrated = false;

export const tokens = {
  /** Read persisted tokens once at startup. */
  async hydrate(): Promise<boolean> {
    if (hydrated) return Boolean(accessToken ?? refreshToken);
    [accessToken, refreshToken] = await Promise.all([
      getItem(ACCESS_KEY),
      getItem(REFRESH_KEY),
    ]);
    hydrated = true;
    return Boolean(accessToken ?? refreshToken);
  },

  access: () => accessToken,
  refresh: () => refreshToken,

  async save(access: string, refresh: string): Promise<void> {
    accessToken = access;
    refreshToken = refresh;
    hydrated = true;
    await Promise.all([setItem(ACCESS_KEY, access), setItem(REFRESH_KEY, refresh)]);
  },

  async clear(): Promise<void> {
    accessToken = null;
    refreshToken = null;
    await Promise.all([deleteItem(ACCESS_KEY), deleteItem(REFRESH_KEY)]);
  },
};

let refreshInFlight: Promise<boolean> | null = null;

async function rotateTokens(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const response = await fetchWithTimeout(`${API_URL}${PREFIX}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) {
      await tokens.clear();
      return false;
    }
    const pair = (await response.json()) as TokenPair;
    await tokens.save(pair.access_token, pair.refresh_token);
    return true;
  } catch {
    // A network failure is not an invalid session — keep the tokens.
    return false;
  }
}

/** Concurrent 401s share one rotation; refresh tokens are single-use. */
function shareRefresh(): Promise<boolean> {
  refreshInFlight ??= rotateTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** In development, name the URL that failed — the usual cause is a wrong host. */
function networkErrorMessage(): string {
  const base = "No connection to the server.";
  return __DEV__ ? `${base} Tried ${API_URL}` : `${base} Check your network.`;
}


async function readError(response: Response): Promise<ApiError> {
  let detail: unknown;
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    detail = body?.detail ?? body;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { loc?: string[]; msg?: string };
      const field = first.loc?.filter((part) => part !== "body").join(".");
      message = field ? `${field}: ${first.msg}` : (first.msg ?? message);
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(response.status, message, detail);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  skipAuth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, skipAuth = false } = options;
  if (!skipAuth) await tokens.hydrate();

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  const url = `${API_URL}${PREFIX}${path}${queryString ? `?${queryString}` : ""}`;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (!skipAuth && accessToken) headers.authorization = `Bearer ${accessToken}`;
    return fetchWithTimeout(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiError(0, networkErrorMessage());
  }

  if (response.status === 401 && !skipAuth && refreshToken) {
    if (await shareRefresh()) {
      try {
        response = await send();
      } catch {
        throw new ApiError(0, networkErrorMessage());
      }
    }
  }

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- endpoints ------------------------------------------------------------

export const api = {
  auth: {
    signup: (payload: {
      email: string;
      phone: string;
      password: string;
      full_name?: string;
      timezone?: string;
    }) =>
      request<AuthResponse>("/auth/signup", {
        method: "POST",
        body: payload,
        skipAuth: true,
      }),
    login: (payload: { email: string; password: string }) =>
      request<AuthResponse>("/auth/login", {
        method: "POST",
        body: payload,
        skipAuth: true,
      }),
    logout: (refresh: string | null) =>
      request<{ detail: string }>("/auth/logout", {
        method: "POST",
        body: { refresh_token: refresh },
      }),
    me: () => request<User>("/auth/me"),
  },

  users: {
    update: (
      payload: Partial<
        Pick<
          User,
          | "full_name"
          | "phone"
          | "timezone"
          | "digest_enabled"
          | "digest_time"
          | "push_enabled"
        >
      >,
    ) => request<User>("/users/me", { method: "PATCH", body: payload }),
    preferences: () => request<NotificationPreference[]>("/users/me/notification-preferences"),
    updatePreference: (payload: Partial<NotificationPreference> & { task_type: string }) =>
      request<NotificationPreference>("/users/me/notification-preferences", {
        method: "PATCH",
        body: payload,
      }),
  },

  cats: {
    list: (query?: { is_active?: boolean; search?: string; limit?: number }) =>
      request<Page<Cat>>("/cats", { query }),
    create: (payload: Partial<Cat> & { name: string }) =>
      request<Cat>("/cats", { method: "POST", body: payload }),
    get: (catId: string) => request<Cat>(`/cats/${catId}`),
    update: (catId: string, payload: Partial<Cat>) =>
      request<Cat>(`/cats/${catId}`, { method: "PATCH", body: payload }),
    remove: (catId: string) => request<void>(`/cats/${catId}`, { method: "DELETE" }),
    weightTrend: (catId: string) => request<WeightTrend>(`/cats/${catId}/weight-trend`),
  },

  feeding: {
    listSchedules: (query?: { cat_id?: string; limit?: number }) =>
      request<Page<FeedingSchedule>>("/feeding-schedules", { query }),
    createSchedule: (payload: {
      cat_id: string;
      label: string;
      scheduled_time: string;
      days_of_week?: number[];
      food_type?: string | null;
      portion_amount?: string | null;
      portion_unit?: string | null;
    }) => request<FeedingSchedule>("/feeding-schedules", { method: "POST", body: payload }),
    updateSchedule: (id: string, payload: Partial<FeedingSchedule>) =>
      request<FeedingSchedule>(`/feeding-schedules/${id}`, { method: "PATCH", body: payload }),
    removeSchedule: (id: string) =>
      request<void>(`/feeding-schedules/${id}`, { method: "DELETE" }),
    listEvents: (query?: {
      cat_id?: string;
      status?: string;
      due_from?: string;
      due_to?: string;
      limit?: number;
    }) => request<Page<FeedingEvent>>("/feeding-events", { query }),
    complete: (id: string, payload: { notes?: string } = {}) =>
      request<FeedingEvent>(`/feeding-events/${id}/complete`, { method: "POST", body: payload }),
    skip: (id: string, payload: { notes?: string } = {}) =>
      request<FeedingEvent>(`/feeding-events/${id}/skip`, { method: "POST", body: payload }),
    generate: (payload: { days?: number } = {}) =>
      request<{ created: number; skipped_existing: number }>("/feeding-events/generate", {
        method: "POST",
        body: payload,
      }),
  },

  cleaning: {
    listTasks: (query?: { zone?: string; limit?: number }) =>
      request<Page<CleaningTask>>("/cleaning-tasks", { query }),
    createTask: (payload: {
      name: string;
      zone: string;
      interval_hours: number;
      rotation_order?: number;
    }) => request<CleaningTask>("/cleaning-tasks", { method: "POST", body: payload }),
    removeTask: (id: string) => request<void>(`/cleaning-tasks/${id}`, { method: "DELETE" }),
    complete: (id: string, payload: { notes?: string } = {}) =>
      request<{ task: CleaningTask; event: CleaningEvent }>(
        `/cleaning-tasks/${id}/complete`,
        { method: "POST", body: payload },
      ),
  },

  vet: {
    list: (query?: { cat_id?: string; outstanding?: boolean; limit?: number }) =>
      request<Page<VetRecord>>("/vet-records", { query }),
    create: (payload: {
      cat_id: string;
      record_type: string;
      title: string;
      due_at?: string | null;
      vet_name?: string | null;
      description?: string | null;
    }) => request<VetRecord>("/vet-records", { method: "POST", body: payload }),
    remove: (id: string) => request<void>(`/vet-records/${id}`, { method: "DELETE" }),
    complete: (id: string, payload: { next_due_at?: string } = {}) =>
      request<VetRecord[]>(`/vet-records/${id}/complete`, { method: "POST", body: payload }),
  },

  weight: {
    list: (query?: { cat_id?: string; limit?: number }) =>
      request<Page<WeightLog>>("/weight-logs", { query }),
    create: (payload: { cat_id: string; weight_grams: number; notes?: string }) =>
      request<WeightLog>("/weight-logs", { method: "POST", body: payload }),
  },

  notifications: {
    list: (query?: { unread_only?: boolean; limit?: number }) =>
      request<Page<AppNotification>>("/notifications", { query }),
    unreadCount: () => request<{ unread: number }>("/notifications/unread-count"),
    markRead: (id: string) =>
      request<AppNotification>(`/notifications/${id}/read`, { method: "POST" }),
    readAll: () => request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    remove: (id: string) => request<void>(`/notifications/${id}`, { method: "DELETE" }),
  },

  due: {
    summary: () => request<DueSummary>("/due-summary"),
    digestPreview: () => request<DigestPreview>("/due-summary/digest-preview"),
  },

  devices: {
    register: (payload: { expo_push_token: string; platform: string; device_name?: string }) =>
      request<{ id: string }>("/devices", { method: "POST", body: payload }),
    list: () => request<{ id: string; expo_push_token: string }[]>("/devices"),
    remove: (deviceId: string) => request<void>(`/devices/${deviceId}`, { method: "DELETE" }),
  },
};
