import { LLM_MODELS } from "../constants";
import type { LlmSettings } from "../types";
import type { ExportSettings } from "../hooks";

type SettingsPanelProps = {
  visible: boolean;
  llmSettings: LlmSettings;
  exportSettings: ExportSettings;
  onProviderChange: (provider: "openai" | "anthropic") => void;
  onSettingsChange: (settings: Partial<LlmSettings>) => void;
  onSelectExportFolder: () => void;
  onResetExportPath: () => void;
};

export function SettingsPanel({
  visible,
  llmSettings,
  exportSettings,
  onProviderChange,
  onSettingsChange,
  onSelectExportFolder,
  onResetExportPath,
}: SettingsPanelProps) {
  if (!visible) return null;

  return (
    <div className="bubble-panel settings-panel" data-no-drag>
      <div className="bubble-header">
        <span>Settings</span>
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

        <div className="settings-divider" />

        <div className="settings-section">
          <label className="settings-label">Export Folder</label>
          <div className="settings-export-path">
            <span className="settings-export-path-text">
              {exportSettings.exportPath || "(Default: AppData)"}
            </span>
          </div>
          <div className="settings-export-buttons">
            <button
              className="settings-export-btn"
              onClick={onSelectExportFolder}
              data-no-drag
            >
              Browse...
            </button>
            {exportSettings.exportPath && (
              <button
                className="settings-export-btn settings-export-reset"
                onClick={onResetExportPath}
                data-no-drag
              >
                Reset
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
