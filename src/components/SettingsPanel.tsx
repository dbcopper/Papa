import { LLM_MODELS } from "../constants";
import type { LlmSettings } from "../types";

type SettingsPanelProps = {
  visible: boolean;
  llmSettings: LlmSettings;
  onClose: () => void;
  onProviderChange: (provider: "openai" | "anthropic") => void;
  onSettingsChange: (settings: Partial<LlmSettings>) => void;
};

export function SettingsPanel({
  visible,
  llmSettings,
  onClose,
  onProviderChange,
  onSettingsChange,
}: SettingsPanelProps) {
  if (!visible) return null;

  return (
    <div className="bubble-panel settings-panel" data-no-drag>
      <div className="bubble-header">
        <span>Settings</span>
        <button
          className="close-button"
          onClick={onClose}
          data-no-drag
        >
          ×
        </button>
      </div>
      <div className="settings-content">
        <div className="settings-section">
          <label className="settings-label">LLM Provider</label>
          <select
            value={llmSettings.provider}
            onChange={(e) => onProviderChange(e.target.value as "openai" | "anthropic")}
            className="settings-input"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div className="settings-section">
          <label className="settings-label">Model</label>
          <select
            value={llmSettings.model}
            onChange={(e) => onSettingsChange({ model: e.target.value })}
            className="settings-input"
          >
            {LLM_MODELS[llmSettings.provider].map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-section">
          <label className="settings-label">API Key</label>
          <input
            type="password"
            value={llmSettings.apiKey}
            onChange={(e) => onSettingsChange({ apiKey: e.target.value })}
            placeholder="Enter your API key"
            className="settings-input"
          />
          <div className="settings-hint">
            {llmSettings.apiKey
              ? "✓ API key configured"
              : "⚠️ API key required for LLM conversations"}
          </div>
        </div>

        <div className="settings-section">
          <button
            className="settings-save-button"
            onClick={onClose}
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}
