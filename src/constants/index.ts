import type { LlmSettings, WindowSize } from "../types";

// ============ Asset Paths ============

export const PET_LAYER_SRC = "/assets/pet-placeholder.png";

// ============ Animation Timing ============

export const BLINK_MIN_MS = 15000;
export const BLINK_MAX_MS = 30000;

// ============ Behavior Settings ============

export const USE_MOCK = true;
export const MOOD_CHECK_INTERVAL = 3000; // Check mood every 3 seconds
export const CONVERSATION_COOLDOWN = 30000; // 30 second cooldown between conversations

// ============ Window Sizes ============

export const WINDOW_COLLAPSED: WindowSize = { width: 320, height: 360 };

// Dynamic window sizes for different panels
export const WINDOW_SIZES = {
  collapsed: { width: 320, height: 360 },
  settings: { width: 620, height: 400 },      // Settings panel
  chat: { width: 640, height: 420 },          // Chat dialog
  filePanel: { width: 640, height: 420 },     // File drop panel
  record: { width: 620, height: 420 },        // Record panel
  papaSpace: { width: 680, height: 460 },     // Papa Space (wider)
  reminder: { width: 620, height: 400 },      // Reminder toast
} as const;

// ============ LLM Settings ============

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "openai",
  apiKey: "",
  model: "gpt-3.5-turbo"
};

export const LLM_MODELS: Record<string, string[]> = {
  openai: ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo"],
  anthropic: ["claude-3-haiku-20240307", "claude-3-sonnet-20240229", "claude-3-opus-20240229"]
};

// ============ Helper Functions ============

export function getRandomBlinkDelay(): number {
  return Math.floor(Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS + 1)) + BLINK_MIN_MS;
}
