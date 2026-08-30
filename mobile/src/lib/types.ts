/** Mirrors the FastAPI response schemas. Keep in sync with backend/app/schemas. */

export type Plan = "free" | "pro";
export type Sex = "male" | "female" | "unknown";
export type TaskType = "feeding" | "cleaning" | "vet" | "vaccination" | "medication";
export type EventStatus = "pending" | "completed" | "missed" | "skipped";
export type VetRecordType =
  | "appointment"
  | "vaccination"
  | "medication"
  | "treatment"
  | "note";
export type NotificationType = "daily_digest" | "overdue" | "upcoming" | "system";
export type DevicePlatform = "ios" | "android" | "web";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface NotificationPreference {
  task_type: TaskType;
  overdue_threshold_minutes: number;
  in_app_enabled: boolean;
  push_enabled: boolean;
  include_in_digest: boolean;
}

export interface User {
  id: string;
  email: string;
  phone: string;
  full_name: string | null;
  plan: Plan;
  is_active: boolean;
  is_email_verified: boolean;
  timezone: string;
  digest_enabled: boolean;
  digest_time: string;
  push_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  notification_preferences: NotificationPreference[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
}

export interface Cat {
  id: string;
  user_id: string;
  name: string;
  breed: string | null;
  color: string | null;
  sex: Sex;
  date_of_birth: string | null;
  microchip_id: string | null;
  photo_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeedingSchedule {
  id: string;
  user_id: string;
  cat_id: string;
  label: string;
  scheduled_time: string;
  days_of_week: number[];
  food_type: string | null;
  portion_amount: string | null;
  portion_unit: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeedingEvent {
  id: string;
  user_id: string;
  cat_id: string;
  schedule_id: string | null;
  due_at: string;
  completed_at: string | null;
  status: EventStatus;
  overdue_alerted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CleaningTask {
  id: string;
  user_id: string;
  name: string;
  zone: string;
  interval_hours: number;
  rotation_order: number;
  next_due_at: string;
  last_completed_at: string | null;
  overdue_alerted_at: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CleaningEvent {
  id: string;
  user_id: string;
  task_id: string | null;
  due_at: string;
  completed_at: string | null;
  status: EventStatus;
  notes: string | null;
  created_at: string;
}

export interface VetRecord {
  id: string;
  user_id: string;
  cat_id: string;
  record_type: VetRecordType;
  title: string;
  description: string | null;
  vet_name: string | null;
  clinic_name: string | null;
  occurred_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  reminder_days_before: number;
  overdue_alerted_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeightLog {
  id: string;
  user_id: string;
  cat_id: string;
  weight_grams: number;
  measured_at: string;
  notes: string | null;
  created_at: string;
}

export interface WeightTrend {
  cat_id: string;
  samples: number;
  first_measured_at: string | null;
  latest_measured_at: string | null;
  latest_grams: number | null;
  change_grams: number | null;
  min_grams: number | null;
  max_grams: number | null;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  task_type: TaskType | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  push_sent_at: string | null;
  created_at: string;
}

export interface DueItem {
  task_type: TaskType;
  entity_id: string;
  title: string;
  due_at: string;
  cat_id: string | null;
  cat_name: string | null;
  is_overdue: boolean;
  overdue_by_minutes: number;
  breaches_threshold: boolean;
}

export interface DueSummary {
  local_date: string;
  timezone: string;
  counts: { overdue: number; today: number; upcoming: number };
  overdue: DueItem[];
  today: DueItem[];
  upcoming: DueItem[];
}

export interface DigestPreview {
  title: string;
  body: string;
  counts: { overdue: number; today: number; upcoming: number };
}
