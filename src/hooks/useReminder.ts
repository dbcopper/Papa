import { useState, useCallback } from "react";
import type { ReminderDuePayload } from "../types";
import { snoozeReminder as snoozeReminderApi, dismissReminder as dismissReminderApi } from "../services/api";

export function useReminder() {
  const [activeReminder, setActiveReminder] = useState<ReminderDuePayload | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const show = useCallback((payload: ReminderDuePayload) => {
    setActiveReminder(payload);
    setToastVisible(true);
  }, []);

  const hide = useCallback(() => {
    setToastVisible(false);
    setActiveReminder(null);
  }, []);

  const snooze = useCallback(async (minutes: number): Promise<boolean> => {
    if (!activeReminder) return false;

    try {
      await snoozeReminderApi(activeReminder.reminder.id, minutes);
      hide();
      return true;
    } catch (err) {
      console.error("Failed to snooze reminder:", err);
      return false;
    }
  }, [activeReminder, hide]);

  const dismiss = useCallback(async (): Promise<boolean> => {
    if (!activeReminder) return false;

    try {
      await dismissReminderApi(activeReminder.reminder.id);
      hide();
      return true;
    } catch (err) {
      console.error("Failed to dismiss reminder:", err);
      return false;
    }
  }, [activeReminder, hide]);

  return {
    activeReminder,
    toastVisible,
    show,
    hide,
    snooze,
    dismiss,
  };
}
