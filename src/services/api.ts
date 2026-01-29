import { invoke } from "@tauri-apps/api/core";
import type {
  TimelineEventWithAttachments,
  CreateDropEventRequest,
  CreateTextEventRequest,
  ListEventsRequest,
  Reminder,
  DailyExport,
} from "../types";

// ============ File Operations ============

export async function saveDroppedFile(fileName: string, content: number[]): Promise<string> {
  return invoke<string>("save_dropped_file", { request: { fileName, content } });
}

// ============ Timeline Event API ============

export async function createDropEvent(request: CreateDropEventRequest): Promise<TimelineEventWithAttachments> {
  return invoke<TimelineEventWithAttachments>("create_drop_event", { request });
}

export async function createTextEvent(request: CreateTextEventRequest): Promise<TimelineEventWithAttachments> {
  return invoke<TimelineEventWithAttachments>("create_text_event", { request });
}

export async function listEvents(request: ListEventsRequest = {}): Promise<TimelineEventWithAttachments[]> {
  return invoke<TimelineEventWithAttachments[]>("list_events", { request });
}

export async function getEventDetail(eventId: string): Promise<TimelineEventWithAttachments> {
  return invoke<TimelineEventWithAttachments>("get_event_detail", { eventId });
}

export async function deleteEvent(eventId: string): Promise<void> {
  return invoke<void>("delete_event", { eventId });
}

export async function updateEventNote(eventId: string, note: string): Promise<void> {
  return invoke<void>("update_event_note", { eventId, note });
}

// ============ Reminder API ============

export async function createReminder(eventId: string, remindAt: number, message: string): Promise<Reminder> {
  return invoke<Reminder>("create_reminder", { eventId, remindAt, message });
}

export async function snoozeReminder(reminderId: string, snoozeMinutes: number): Promise<void> {
  return invoke<void>("snooze_reminder", { reminderId, snoozeMinutes });
}

export async function dismissReminder(reminderId: string): Promise<void> {
  return invoke<void>("dismiss_reminder", { reminderId });
}

export async function listPendingReminders(): Promise<Reminder[]> {
  return invoke<Reminder[]>("list_pending_reminders");
}

// ============ Settings API ============

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}

export async function listSettings(): Promise<[string, string][]> {
  return invoke<[string, string][]>("list_settings");
}

// ============ Export API ============

export async function generateDailyExport(dateKey: string, format: string): Promise<string> {
  return invoke<string>("generate_daily_export", { dateKey, format });
}

export async function listExports(): Promise<DailyExport[]> {
  return invoke<DailyExport[]>("list_exports");
}

export async function openExportFolder(): Promise<string> {
  return invoke<string>("open_export_folder");
}

// ============ Window API ============

export async function setWindowSize(width: number, height: number): Promise<void> {
  return invoke<void>("set_window_size", { width, height });
}

export async function hideWindow(ms: number): Promise<void> {
  return invoke<void>("hide_for", { ms });
}

// ============ LLM API ============

export type LlmRequest = {
  provider: string;
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
};

export async function callLlmApi(request: LlmRequest): Promise<string> {
  return invoke<string>("call_llm_api", { request });
}
