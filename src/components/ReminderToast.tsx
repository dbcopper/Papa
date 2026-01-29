import type { ReminderDuePayload } from "../types";

type ReminderToastProps = {
  visible: boolean;
  reminder: ReminderDuePayload | null;
  onClose: () => void;
  onDismiss: () => void;
  onSnooze: (minutes: number) => void;
};

export function ReminderToast({
  visible,
  reminder,
  onClose,
  onDismiss,
  onSnooze,
}: ReminderToastProps) {
  if (!visible || !reminder) return null;

  return (
    <div className="bubble-panel reminder-panel" data-no-drag>
      <div className="bubble-header">
        <span>⏰ Reminder</span>
        <button
          className="close-button"
          onClick={onClose}
          data-no-drag
        >
          ×
        </button>
      </div>
      <div className="reminder-panel-content">
        <p className="reminder-panel-message">{reminder.reminder.message}</p>
        {reminder.attachments.length > 0 && (
          <div className="reminder-panel-attachment">
            <span className="reminder-panel-attachment-icon">
              {reminder.event.type === "image" ? "🖼️" : "📄"}
            </span>
            <span className="reminder-panel-attachment-name">
              {reminder.attachments[0].fileName || "Attachment"}
            </span>
          </div>
        )}
      </div>
      <div className="reminder-panel-actions">
        <button
          className="reminder-panel-done"
          onClick={onDismiss}
          data-no-drag
        >
          ✅ Done
        </button>
        <div className="reminder-panel-snooze-group">
          <button
            className="reminder-panel-snooze"
            onClick={() => onSnooze(10)}
            data-no-drag
          >
            10 min
          </button>
          <button
            className="reminder-panel-snooze"
            onClick={() => onSnooze(60)}
            data-no-drag
          >
            1 hour
          </button>
        </div>
      </div>
    </div>
  );
}
