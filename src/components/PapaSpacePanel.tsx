import { formatTime } from "../utils/helpers";
import type { TimelineEventWithAttachments } from "../types";

type PapaSpacePanelProps = {
  visible: boolean;
  events: TimelineEventWithAttachments[];
  selectedDate: string;
  loading: boolean;
  aiSummary: string;
  aiSummaryLoading: boolean;
  showSummary: boolean;
  editingEvent: TimelineEventWithAttachments | null;
  editNote: string;
  onClose: () => void;
  onDateChange: (dateKey: string) => void;
  onStartEdit: (item: TimelineEventWithAttachments) => void;
  onRemoveEvent: (id: number) => void;
  onSaveEventNote: () => void;
  onSetShowSummary: (show: boolean) => void;
  onSetEditNote: (note: string) => void;
  onSetEditingEvent: (event: TimelineEventWithAttachments | null) => void;
  onGenerateAISummary: () => void;
  onExportDay: (format: "md" | "html") => void;
  onOpenExportsFolder: () => void;
  getRecentDates: () => string[];
  formatDateDisplay: (dateKey: string) => string;
};

export function PapaSpacePanel({
  visible,
  events,
  selectedDate,
  loading,
  aiSummary,
  aiSummaryLoading,
  showSummary,
  editingEvent,
  editNote,
  onClose,
  onDateChange,
  onStartEdit,
  onRemoveEvent,
  onSaveEventNote,
  onSetShowSummary,
  onSetEditNote,
  onSetEditingEvent,
  onGenerateAISummary,
  onExportDay,
  onOpenExportsFolder,
  getRecentDates,
  formatDateDisplay,
}: PapaSpacePanelProps) {
  if (!visible) return null;

  return (
    <div className="bubble-panel papa-space" data-no-drag>
      <div className="bubble-header">
        <span>📋 Papa Space</span>
        <button
          className="close-button"
          onClick={onClose}
          data-no-drag
        >
          ×
        </button>
      </div>
      <div className="papa-space-content">
        {/* Action buttons */}
        <div className="papa-space-export-bar">
          <button
            className="papa-space-ai-btn"
            onClick={onGenerateAISummary}
            disabled={aiSummaryLoading}
            data-no-drag
          >
            {aiSummaryLoading ? "✨ Thinking..." : "✨ AI Summary"}
          </button>
          <div className="papa-space-export-group">
            <button
              className="papa-space-export-btn"
              onClick={() => onExportDay("md")}
              data-no-drag
            >
              📄 MD
            </button>
            <button
              className="papa-space-export-btn"
              onClick={() => onExportDay("html")}
              data-no-drag
            >
              🌐 HTML
            </button>
            <button
              className="papa-space-export-btn"
              onClick={onOpenExportsFolder}
              data-no-drag
            >
              📁
            </button>
          </div>
        </div>

        {/* Date selector */}
        <div className="papa-space-dates">
          {getRecentDates().map((dateKey) => (
            <button
              key={dateKey}
              className={`papa-space-date-btn ${dateKey === selectedDate ? "active" : ""}`}
              onClick={() => onDateChange(dateKey)}
              data-no-drag
            >
              {formatDateDisplay(dateKey)}
            </button>
          ))}
        </div>

        {/* AI Summary */}
        {showSummary && (
          <div className="papa-space-ai-summary" data-no-drag>
            <div className="papa-space-ai-summary-header">
              <span>✨ Daily Summary</span>
              <button
                className="papa-space-ai-summary-close"
                onClick={() => onSetShowSummary(false)}
                data-no-drag
              >
                ×
              </button>
            </div>
            <div className="papa-space-ai-summary-content">
              {aiSummaryLoading ? (
                <div className="papa-space-ai-summary-loading">
                  <span className="loading-dots">Thinking</span>
                </div>
              ) : (
                <div className="papa-space-ai-summary-text">
                  {aiSummary.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="papa-space-timeline">
          {loading ? (
            <div className="papa-space-loading">Loading...</div>
          ) : events.length === 0 ? (
            <div className="papa-space-empty">No records for this day</div>
          ) : (
            events.map((item) => (
              <div key={item.event.id} className="papa-space-event">
                <div className="papa-space-event-time">
                  {formatTime(item.event.createdAt)}
                </div>
                <div className="papa-space-event-content">
                  <div className="papa-space-event-header">
                    <span className="papa-space-event-icon">
                      {item.event.type === "image" ? "🖼️" : item.event.type === "text" ? "📝" : "📄"}
                    </span>
                    <span className="papa-space-event-title">
                      {item.event.title || item.event.note?.slice(0, 20) || "Untitled"}
                    </span>
                    <div className="papa-space-event-actions">
                      <button
                        className="papa-space-event-edit"
                        onClick={() => onStartEdit(item)}
                        data-no-drag
                      >
                        ✏️
                      </button>
                      <button
                        className="papa-space-event-delete"
                        onClick={() => onRemoveEvent(item.event.id)}
                        data-no-drag
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  {item.event.note && (
                    <p className="papa-space-event-note">{item.event.note}</p>
                  )}
                  {item.attachments.length > 0 && (
                    <div className="papa-space-event-attachments">
                      {item.attachments.map((att) => (
                        <span key={att.id} className="papa-space-attachment">
                          {att.kind === "image" ? "🖼️" : "📎"} {att.fileName}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.reminders.length > 0 && (
                    <div className="papa-space-event-reminders">
                      {item.reminders.map((rem) => (
                        <span key={rem.id} className={`papa-space-reminder ${rem.status}`}>
                          ⏰ {rem.status === "pending" ? "pending" : rem.status === "dismissed" ? "done" : rem.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Edit modal */}
        {editingEvent && (
          <div className="papa-space-edit-modal">
            <div className="papa-space-edit-header">Edit Note</div>
            <textarea
              value={editNote}
              onChange={(e) => onSetEditNote(e.target.value)}
              className="papa-space-edit-input"
              rows={3}
              data-no-drag
            />
            <div className="papa-space-edit-actions">
              <button
                onClick={() => {
                  onSetEditingEvent(null);
                  onSetEditNote("");
                }}
                data-no-drag
              >
                Cancel
              </button>
              <button onClick={onSaveEventNote} data-no-drag>
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
