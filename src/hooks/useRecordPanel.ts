import { useState, useCallback, useRef } from "react";
import type { TimelineEventWithAttachments } from "../types";
import { createDropEvent, createTextEvent } from "../services/api";

export function useRecordPanel() {
  const [visible, setVisible] = useState(false);
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [pendingText, setPendingText] = useState<string>("");
  const [note, setNote] = useState("");
  const [remindEnabled, setRemindEnabled] = useState(false);
  const [remindAt, setRemindAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<TimelineEventWithAttachments | null>(null);

  const noteRef = useRef<HTMLTextAreaElement>(null);

  const reset = useCallback(() => {
    setPendingPaths([]);
    setPendingText("");
    setNote("");
    setRemindEnabled(false);
    setRemindAt(null);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    reset();
  }, [reset]);

  const setQuickRemind = useCallback((minutes: number) => {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    setRemindAt(date);
    setRemindEnabled(true);
  }, []);

  const save = useCallback(async (): Promise<TimelineEventWithAttachments | null> => {
    if (pendingPaths.length === 0 && !pendingText) return null;

    setSaving(true);
    try {
      const remindAtMs = remindEnabled && remindAt ? remindAt.getTime() : undefined;
      let result: TimelineEventWithAttachments;

      if (pendingText) {
        result = await createTextEvent({
          textContent: pendingText,
          note: note.trim(),
          remindAt: remindAtMs,
          remindMessage: note.trim() || undefined,
        });
      } else {
        result = await createDropEvent({
          paths: pendingPaths,
          note: note.trim() || undefined,
          remindAt: remindAtMs,
          remindMessage: note.trim() || undefined,
        });
      }

      setCurrentEvent(result);
      return result;
    } catch (err) {
      console.error("Failed to save record:", err);
      return null;
    } finally {
      setSaving(false);
    }
  }, [pendingPaths, pendingText, note, remindEnabled, remindAt]);

  const focusNote = useCallback(() => {
    setTimeout(() => {
      noteRef.current?.focus();
    }, 100);
  }, []);

  return {
    // State
    visible,
    pendingPaths,
    pendingText,
    note,
    remindEnabled,
    remindAt,
    saving,
    currentEvent,
    noteRef,

    // Setters (for direct manipulation)
    setVisible,
    setPendingPaths,
    setPendingText,
    setNote,
    setRemindEnabled,
    setRemindAt,
    setSaving,
    setCurrentEvent,

    // Actions
    reset,
    close,
    setQuickRemind,
    save,
    focusNote,
  };
}
