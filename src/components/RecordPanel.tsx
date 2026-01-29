import { RefObject } from "react";
import { getFileDisplayName, isImageFile } from "../utils/helpers";

type RecordPanelProps = {
  visible: boolean;
  pendingPaths: string[];
  pendingText: string;
  note: string;
  remindEnabled: boolean;
  remindAt: Date | null;
  saving: boolean;
  noteRef: RefObject<HTMLTextAreaElement>;
  onNoteChange: (value: string) => void;
  onRemindEnabledChange: (enabled: boolean) => void;
  onRemindAtChange: (date: Date | null) => void;
  onQuickRemind: (minutes: number) => void;
  onSave: () => void;
  onCancel: () => void;
  formatRemindTime: (date: Date) => string;
};

export function RecordPanel({
  visible,
  pendingPaths,
  pendingText,
  note,
  remindEnabled,
  remindAt,
  saving,
  noteRef,
  onNoteChange,
  onRemindEnabledChange,
  onRemindAtChange,
  onQuickRemind,
  onSave,
  onCancel,
  formatRemindTime,
}: RecordPanelProps) {
  if (!visible) return null;

  return (
    <div className="bubble-panel record-panel" data-no-drag>
      <div className="bubble-header">
        <span>📝 Record</span>
        <button
          className="close-button"
          onClick={onCancel}
          data-no-drag
        >
          ×
        </button>
      </div>
      <div className="record-content">
        {/* File or Text preview */}
        {pendingText ? (
          <div className="record-text-preview">
            <span className="record-text-icon">📝</span>
            <div className="record-text-content">
              {pendingText.length > 200
                ? pendingText.slice(0, 200) + "..."
                : pendingText}
            </div>
          </div>
        ) : (
          <div className="record-files">
            {pendingPaths.map((path, index) => (
              <div key={index} className="record-file-item">
                <span className="record-file-icon">
                  {isImageFile(path) ? "🖼️" : "📄"}
                </span>
                <span className="record-file-name">{getFileDisplayName(path)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Note input */}
        <div className="record-note-section">
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Add a note..."
            className="record-note-input"
            rows={2}
            data-no-drag
          />
        </div>

        {/* Remind toggle */}
        <div className="record-remind-section">
          <label className="record-remind-toggle">
            <input
              type="checkbox"
              checked={remindEnabled}
              onChange={(e) => {
                onRemindEnabledChange(e.target.checked);
                if (!e.target.checked) {
                  onRemindAtChange(null);
                }
              }}
              data-no-drag
            />
            <span>⏰ Remind me</span>
          </label>

          {remindEnabled && (
            <div className="record-remind-options">
              <div className="record-remind-quick">
                <button onClick={() => onQuickRemind(10)} data-no-drag>10 min</button>
                <button onClick={() => onQuickRemind(60)} data-no-drag>1 hour</button>
                <button onClick={() => onQuickRemind(60 * 24)} data-no-drag>Tomorrow</button>
                <button onClick={() => onQuickRemind(60 * 24 * 3)} data-no-drag>3 days</button>
              </div>
              {remindAt && (
                <div className="record-remind-time">
                  {formatRemindTime(remindAt)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="record-actions">
          <button
            className="record-cancel-button"
            onClick={onCancel}
            disabled={saving}
            data-no-drag
          >
            Cancel
          </button>
          <button
            className="record-save-button"
            onClick={onSave}
            disabled={saving}
            data-no-drag
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
