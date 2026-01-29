// ============ Pet Types ============

export type PetState =
  | "idle_breathe"
  | "idle_blink"
  | "eat_chomp"
  | "thinking"
  | "success_happy"
  | "error_confused"
  | "waiting_for_drop"
  | "idle"
  | "think"
  | "happy"
  | "comfy"
  | "shy"
  | "cry"
  | "drool"
  | "excited"
  | "tired"
  | "angry"
  | "surprised"
  | "sleepy"
  | "chew"
  | "eat_action";

// ============ Legacy Drop Types ============

export type DropRecord = {
  id: number;
  path: string;
  hash: string;
  createdAt: number;
};

export type DropProcessedPayload = {
  record: DropRecord;
};

// ============ Behavior Analysis Types ============

export type BehaviorAnalysis = {
  typingSpeed: number;
  keyPressCount: number;
  backspaceCount: number;
  mouseMoveSpeed: number;
  mouseClickCount: number;
  idleTime: number;
  activityLevel: number;
};

export type UserMood = "focused" | "tired" | "excited" | "confused" | "relaxed" | null;

// ============ Conversation Types ============

export type ConversationBubble = {
  id: number;
  text: string;
  visible: boolean;
};

// ============ LLM Types ============

export type LlmProvider = "openai" | "anthropic";

export type LlmSettings = {
  provider: LlmProvider;
  apiKey: string;
  model: string;
};

// ============ Timeline Types ============

export type TimelineEvent = {
  id: string;
  type: "file" | "image" | "text" | "thought";
  title: string | null;
  note: string | null;
  textContent: string | null;
  createdAt: number;
  source: "drop" | "manual" | "clipboard" | null;
  isDeleted: boolean;
};

export type Attachment = {
  id: string;
  eventId: string;
  kind: "file" | "image";
  originalPath: string;
  storedPath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  createdAt: number;
};

export type Reminder = {
  id: string;
  eventId: string;
  remindAt: number;
  message: string;
  status: "pending" | "triggered" | "dismissed" | "snoozed";
  triggeredAt: number | null;
  snoozeUntil: number | null;
  createdAt: number;
};

export type TimelineEventWithAttachments = {
  event: TimelineEvent;
  attachments: Attachment[];
  reminders: Reminder[];
};

// ============ API Request Types ============

export type CreateDropEventRequest = {
  paths: string[];
  note?: string;
  remindAt?: number;
  remindMessage?: string;
};

export type CreateTextEventRequest = {
  note: string;
  textContent?: string;
  remindAt?: number;
  remindMessage?: string;
};

export type ListEventsRequest = {
  startDate?: number;
  endDate?: number;
  page?: number;
  pageSize?: number;
};

// ============ Export Types ============

export type DailyExport = {
  id: string;
  dateKey: string;
  outputFormat: string;
  outputPath: string;
  createdAt: number;
};

// ============ Event Payload Types ============

export type ReminderDuePayload = {
  reminder: Reminder;
  event: TimelineEvent;
  attachments: Attachment[];
};

// ============ Window Types ============

export type WindowSize = {
  width: number;
  height: number;
};

// ============ Context Menu Types ============

export type ContextMenuState = {
  x: number;
  y: number;
  visible: boolean;
};
