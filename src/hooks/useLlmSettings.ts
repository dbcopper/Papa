import { useState, useCallback } from "react";
import type { LlmSettings } from "../types";
import { DEFAULT_LLM_SETTINGS, LLM_MODELS } from "../constants";

export function useLlmSettings() {
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => {
    // Load from localStorage
    const saved = localStorage.getItem("llmSettings");
    if (saved) {
      try {
        return { ...DEFAULT_LLM_SETTINGS, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_LLM_SETTINGS;
      }
    }
    return DEFAULT_LLM_SETTINGS;
  });

  const updateSettings = useCallback((updates: Partial<LlmSettings>) => {
    setLlmSettings((prev) => {
      const newSettings = { ...prev, ...updates };
      localStorage.setItem("llmSettings", JSON.stringify(newSettings));
      return newSettings;
    });
  }, []);

  const updateProvider = useCallback((provider: "openai" | "anthropic") => {
    setLlmSettings((prev) => {
      const newSettings = {
        ...prev,
        provider,
        model: LLM_MODELS[provider][0], // Reset to first model of new provider
      };
      localStorage.setItem("llmSettings", JSON.stringify(newSettings));
      return newSettings;
    });
  }, []);

  const isConfigured = Boolean(llmSettings.apiKey);

  return {
    llmSettings,
    setLlmSettings,
    updateSettings,
    updateProvider,
    isConfigured,
  };
}
