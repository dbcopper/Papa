import { getCurrentWindow } from "@tauri-apps/api/window";

type ContextMenuProps = {
  x: number;
  y: number;
  visible: boolean;
  onClose: () => void;
  onOpenPapaSpace: () => void;
  onOpenSettings: () => void;
};

export function ContextMenu({
  x,
  y,
  visible,
  onClose,
  onOpenPapaSpace,
  onOpenSettings,
}: ContextMenuProps) {
  if (!visible) return null;

  const appWindow = getCurrentWindow();

  const handleHideToTray = async () => {
    onClose();
    await appWindow.hide();
  };

  const handleQuit = async () => {
    try {
      await appWindow.close();
    } catch (e) {
      // Fallback: try destroy
      try {
        await appWindow.destroy();
      } catch {
        console.error("Failed to quit:", e);
      }
    }
  };

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      data-no-drag
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          onClose();
          onOpenPapaSpace();
        }}
      >
        📋 Papa Space
      </button>
      <button
        onClick={() => {
          onClose();
          onOpenSettings();
        }}
      >
        ⚙️ Settings
      </button>
      <button onClick={() => void handleHideToTray()}>
        📥 Hide to Tray
      </button>
      <button onClick={() => void handleQuit()} className="context-menu-quit">
        ❌ Quit
      </button>
    </div>
  );
}
