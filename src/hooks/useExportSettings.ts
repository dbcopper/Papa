import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

export type ExportSettings = {
  exportPath: string; // Empty string means default (AppData/exports)
};

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  exportPath: "",
};

export function useExportSettings() {
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => {
    const saved = localStorage.getItem("exportSettings");
    if (saved) {
      try {
        return { ...DEFAULT_EXPORT_SETTINGS, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_EXPORT_SETTINGS;
      }
    }
    return DEFAULT_EXPORT_SETTINGS;
  });

  const updateExportPath = useCallback((path: string) => {
    setExportSettings((prev) => {
      const newSettings = { ...prev, exportPath: path };
      localStorage.setItem("exportSettings", JSON.stringify(newSettings));
      return newSettings;
    });
  }, []);

  const selectExportFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Export Folder",
      });
      if (selected && typeof selected === "string") {
        updateExportPath(selected);
        return selected;
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    }
    return null;
  }, [updateExportPath]);

  const resetToDefault = useCallback(() => {
    updateExportPath("");
  }, [updateExportPath]);

  return {
    exportSettings,
    updateExportPath,
    selectExportFolder,
    resetToDefault,
  };
}
