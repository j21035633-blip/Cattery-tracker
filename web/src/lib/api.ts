/**
 * Typed API client.
 *
 * Handles one thing the components should never think about: an access token
 * that expires every 30 minutes. On a 401 the client rotates the refresh token
 * once and replays the original request. Concurrent 401s share a single refresh
 * so a page with six widgets does not burn six refresh tokens (the backend
 * rotates single-use, so the extra five would be rejected).
 */

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

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const PREFIX = "/api/v1";

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
}

// --- token storage --------------------------------------------------------
// localStorage rather than a cookie: the same client also serves the Expo app
// through the same bearer-token contract, and there is no SSR data fetching
// here that would need the token server-side.

export const tokens = {
  access: (): string | null =>
    typeof window === "undefined" ? null : window.localStorage.getItem(ACCESS_KEY),
  refresh: (): string | null =>
    typeof window === "undefined" ? null : window.localStorage.getItem(REFRESH_KEY),
  save(access: string, refresh: string): void {
    window.localStorage.setItem(ACCESS_KEY, access);
    window.localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refresh = tokens.refresh();
  if (!refresh) return false;

  const response = await fetch(`${API_URL}${PREFIX}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!response.ok) {
    tokens.clear();
    return false;
  }
  const pair = (await response.json()) as TokenPair;
  tokens.save(pair.access_token, pair.refresh_token);
  return true;
}

function shareRefresh(): Promise<boolean> {
  refreshInFlight ??= refreshTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function readError(response: Response): Promise<ApiError> {
  let detail: unknown;
  let message = response.statusText || `Request failed (${response.status})`;
  try {
    const body = await response.json();
    detail = body?.detail ?? body;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail) && detail.length > 0) {
      // FastAPI validation errors: surface the first field message.
      const first = detail[0] as { loc?: string[]; msg?: string };
      const field = first.loc?.filter((part) => part !== "body").join(".");
      message = field ? `${field}: ${first.msg}` : (first.msg ?? message);
    }
  } catch {
    /* non-JSON error body; keep the status text */
  }
  return new ApiError(response.status, message, detail);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Set for the auth endpoints, which must not trigger a refresh loop. */
  skipAuth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, skipAuth = false } = options;

  const url = new URL(`${API_URL}${PREFIX}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const access = skipAuth ? null : tokens.access();
    if (access) headers.authorization = `Bearer ${access}`;

    return fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await send();
  if (response.status === 401 && !skipAuth && tokens.refresh()) {
    if (await shareRefresh()) {
      response = await send();
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
    }) => request<AuthResponse>("/auth/signup", { method: "POST", body: payload, skipAuth: true }),

    login: (payload: { email: string; password: string }) =>
      request<AuthResponse>("/auth/login", { method: "POST", body: payload, skipAuth: true }),

    logout: (refreshToken: string | null) =>
      request<{ detail: string }>("/auth/logout", {
        method: "POST",
        body: { refresh_token: refreshToken },
      }),

    me: () => request<User>("/auth/me"),

    changePassword: (payload: { current_password: string; new_password: string }) =>
      request<AuthResponse>("/auth/change-password", { method: "POST", body: payload }),
  },

  users: {
    me: () => request<User>("/users/me"),
    update: (payload: Partial<Pick<User, "full_name" | "phone" | "timezone" | "digest_enabled" | "digest_time" | "push_enabled">>) =>
      request<User>("/users/me", { method: "PATCH", body: payload }),
    preferences: () => request<NotificationPreference[]>("/users/me/notification-preferences"),
    updatePreference: (payload: Partial<NotificationPreference> & { task_type: string }) =>
      request<NotificationPreference>("/users/me/notification-preferences", {
        method: "PATCH",
        body: payload,
      }),
  },

  cats: {
    list: (query?: { is_active?: boolean; search?: string; limit?: number; offset?: number }) =>
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
    listSchedules: (query?: { cat_id?: string; is_active?: boolean; limit?: number }) =>
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
    complete: (id: string, payload: { completed_at?: string; notes?: string } = {}) =>
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
    listTasks: (query?: { zone?: string; is_active?: boolean; limit?: number }) =>
      request<Page<CleaningTask>>("/cleaning-tasks", { query }),
    createTask: (payload: {
      name: string;
      zone: string;
      interval_hours: number;
      rotation_order?: number;
      next_due_at?: string;
    }) => request<CleaningTask>("/cleaning-tasks", { method: "POST", body: payload }),
    updateTask: (id: string, payload: Partial<CleaningTask>) =>
      request<CleaningTask>(`/cleaning-tasks/${id}`, { method: "PATCH", body: payload }),
    removeTask: (id: string) => request<void>(`/cleaning-tasks/${id}`, { method: "DELETE" }),
    complete: (id: string, payload: { completed_at?: string; notes?: string } = {}) =>
      request<{ task: CleaningTask; event: CleaningEvent }>(`/cleaning-tasks/${id}/complete`, {
        method: "POST",
        body: payload,
      }),
    listEvents: (query?: { task_id?: string; limit?: number }) =>
      request<Page<CleaningEvent>>("/cleaning-events", { query }),
  },

  vet: {
    list: (query?: {
      cat_id?: string;
      record_type?: string;
      outstanding?: boolean;
      limit?: number;
    }) => request<Page<VetRecord>>("/vet-records", { query }),
    create: (payload: {
      cat_id: string;
      record_type: string;
      title: string;
      due_at?: string | null;
      occurred_at?: string | null;
      vet_name?: string | null;
      clinic_name?: string | null;
      description?: string | null;
      reminder_days_before?: number;
    }) => request<VetRecord>("/vet-records", { method: "POST", body: payload }),
    update: (id: string, payload: Partial<VetRecord>) =>
      request<VetRecord>(`/vet-records/${id}`, { method: "PATCH", body: payload }),
    remove: (id: string) => request<void>(`/vet-records/${id}`, { method: "DELETE" }),
    complete: (id: string, payload: { completed_at?: string; next_due_at?: string } = {}) =>
      request<VetRecord[]>(`/vet-records/${id}/complete`, { method: "POST", body: payload }),
  },

  weight: {
    list: (query?: { cat_id?: string; limit?: number }) =>
      request<Page<WeightLog>>("/weight-logs", { query }),
    create: (payload: { cat_id: string; weight_grams: number; measured_at?: string; notes?: string }) =>
      request<WeightLog>("/weight-logs", { method: "POST", body: payload }),
    remove: (id: string) => request<void>(`/weight-logs/${id}`, { method: "DELETE" }),
  },

  notifications: {
    list: (query?: { unread_only?: boolean; type?: string; limit?: number; offset?: number }) =>
      request<Page<AppNotification>>("/notifications", { query }),
    unreadCount: () => request<{ unread: number }>("/notifications/unread-count"),
    markRead: (id: string) =>
      request<AppNotification>(`/notifications/${id}/read`, { method: "POST" }),
    markUnread: (id: string) =>
      request<AppNotification>(`/notifications/${id}/unread`, { method: "POST" }),
    readAll: () => request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    remove: (id: string) => request<void>(`/notifications/${id}`, { method: "DELETE" }),
  },

  due: {
    summary: () => request<DueSummary>("/due-summary"),
    digestPreview: () => request<DigestPreview>("/due-summary/digest-preview"),
    sendDigest: () =>
      request<AppNotification | null>("/due-summary/send-digest", { method: "POST" }),
  },

  devices: {
    register: (payload: {
      expo_push_token: string;
      platform: string;
      device_name?: string;
    }) => request<unknown>("/devices", { method: "POST", body: payload }),
  },
};
