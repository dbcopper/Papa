import { useState, useCallback } from "react";
import type { TimelineEventWithAttachments } from "../types";
import { listEvents, deleteEvent, updateEventNote, generateDailyExport, openExportFolder } from "../services/api";
import { formatLocalDate } from "../utils/helpers";

export function usePapaSpace() {
  const [visible, setVisible] = useState(false);
  const [events, setEvents] = useState<TimelineEventWithAttachments[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => formatLocalDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEventWithAttachments | null>(null);
  const [editNote, setEditNote] = useState("");
  const [aiSummary, setAISummary] = useState<string>("");
  const [aiSummaryLoading, setAISummaryLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const loadEvents = useCallback(async (dateKey: string) => {
    console.log("Loading Papa Space events for:", dateKey);
    setLoading(true);
    try {
      const startOfDay = new Date(dateKey + "T00:00:00").getTime();
      const endOfDay = new Date(dateKey + "T23:59:59.999").getTime();
      console.log("Date range:", startOfDay, "to", endOfDay);

      const result = await listEvents({
        startDate: startOfDay,
        endDate: endOfDay,
        pageSize: 100,
      });
      console.log("Loaded events:", result.length);
      setEvents(result);
    } catch (err) {
      console.error("Failed to load events:", err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(() => {
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setEditingEvent(null);
    setShowSummary(false);
  }, []);

  const changeDate = useCallback(async (dateKey: string) => {
    setSelectedDate(dateKey);
    setShowSummary(false);
    setAISummary("");
    await loadEvents(dateKey);
  }, [loadEvents]);

  const removeEvent = useCallback(async (eventId: string) => {
    try {
      await deleteEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.event.id !== eventId));
    } catch (err) {
      console.error("Failed to delete event:", err);
    }
  }, []);

  const saveEventNote = useCallback(async () => {
    if (!editingEvent) return;
    try {
      await updateEventNote(editingEvent.event.id, editNote);
      setEvents((prev) =>
        prev.map((e) =>
          e.event.id === editingEvent.event.id
            ? { ...e, event: { ...e.event, note: editNote } }
            : e
        )
      );
      setEditingEvent(null);
    } catch (err) {
      console.error("Failed to update note:", err);
    }
  }, [editingEvent, editNote]);

  const startEdit = useCallback((event: TimelineEventWithAttachments) => {
    setEditingEvent(event);
    setEditNote(event.event.note || "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingEvent(null);
    setEditNote("");
  }, []);

  const exportDay = useCallback(async (format: string = "markdown") => {
    try {
      const path = await generateDailyExport(selectedDate, format);
      console.log("Exported to:", path);
      return path;
    } catch (err) {
      console.error("Failed to export:", err);
      throw err;
    }
  }, [selectedDate]);

  const openExportsFolder = useCallback(async () => {
    try {
      await openExportFolder();
    } catch (err) {
      console.error("Failed to open export folder:", err);
    }
  }, []);

  // Helper: get recent dates (last 14 days)
  const getRecentDates = useCallback((): string[] => {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dates.push(formatLocalDate(date));
    }
    return dates;
  }, []);

  // Helper: format date for display
  const formatDateDisplay = useCallback((dateKey: string): string => {
    const date = new Date(dateKey + "T00:00:00");
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (dateKey === formatLocalDate(today)) {
      return "Today";
    }
    if (dateKey === formatLocalDate(yesterday)) {
      return "Yesterday";
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }, []);

  return {
    // State
    visible,
    events,
    selectedDate,
    loading,
    editingEvent,
    editNote,
    aiSummary,
    aiSummaryLoading,
    showSummary,

    // Setters (for direct state manipulation when needed)
    setVisible,
    setSelectedDate,
    setLoading,
    setEditingEvent,
    setEditNote,
    setAISummary,
    setAISummaryLoading,
    setShowSummary,
    setEvents,

    // Actions
    open,
    close,
    loadEvents,
    changeDate,
    removeEvent,
    saveEventNote,
    startEdit,
    cancelEdit,
    exportDay,
    openExportsFolder,

    // Helpers
    getRecentDates,
    formatDateDisplay,
  };
}
