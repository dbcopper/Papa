import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { animate } from "animejs";

const PET_LAYER_SRC = "/assets/pet-placeholder.png";

type PetState =
  | "idle_breathe"
  | "idle_blink"
  | "eat_chomp"
  | "thinking"
  | "success_happy"
  | "error_confused"
  | "waiting_for_drop";

type DropRecord = {
  id: number;
  path: string;
  hash: string;
  createdAt: number;
};

type DropProcessedPayload = {
  record: DropRecord;
};

const BLINK_MIN_MS = 15000; /* 更频繁的眨眼，更可爱 */
const BLINK_MAX_MS = 30000;
const USE_MOCK = true;
const WINDOW_COLLAPSED = { width: 320, height: 320 };
const WINDOW_EXPANDED = { width: 720, height: 320 }; // Width expanded for panel, height stays 320

function getRandomBlinkDelay() {
  return Math.floor(
    BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS)
  );
}

function mockResponseText(kind: "summarize" | "actions" | "remember") {
  if (kind === "summarize") {
    return "Summary: This file looks like a short document with a clear structure and a few key sections. Focus on the main headings and skim for important dates or decisions.";
  }
  if (kind === "actions") {
    return "Action items: 1) Review the document structure. 2) Extract key dates. 3) Notify stakeholders about the main changes.";
  }
  return "Remembered: Stored file metadata and a short note. You can tag this record later for easy retrieval.";
}

async function getResponseText(
  kind: "summarize" | "actions" | "remember"
): Promise<string> {
  if (USE_MOCK) {
    return mockResponseText(kind);
  }
  return "LLM integration pending.";
}

function useOutsideClick(
  ref: React.RefObject<HTMLDivElement>,
  onClose: () => void
) {
  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      onClose();
    }

    window.addEventListener("pointerdown", handlePointer);
    return () => window.removeEventListener("pointerdown", handlePointer);
  }, [onClose, ref]);
}

function StreamingText({
  text,
  speedMs,
  onComplete
}: {
  text: string;
  speedMs: number;
  onComplete: () => void;
}) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    let index = 0;
    let cancelled = false;

    function step() {
      if (cancelled) return;
      index += 1;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) {
        onComplete();
        return;
      }
      setTimeout(step, speedMs);
    }

    setDisplayed("");
    if (text.length > 0) {
      setTimeout(step, speedMs);
    }

    return () => {
      cancelled = true;
    };
  }, [text, speedMs, onComplete]);

  return <p className="streaming-text">{displayed}</p>;
}

export default function App() {
  const [petState, setPetState] = useState<PetState>("idle_breathe");
  const [panelVisible, setPanelVisible] = useState(false);
  const [dropRecord, setDropRecord] = useState<DropRecord | null>(null);
  const [panelMode, setPanelMode] = useState<
    "summarize" | "actions" | "remember" | null
  >(null);
  const [panelText, setPanelText] = useState("");
  const [streamKey, setStreamKey] = useState(0);
  const [panelLockUntil, setPanelLockUntil] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showDebugControls, setShowDebugControls] = useState(false);
  const [debugInfo, setDebugInfo] = useState({
    lastDomDrag: "none",
    domDragCount: 0,
    lastResize: "none"
  });
  const [currentWindowSize, setCurrentWindowSize] = useState(
    WINDOW_COLLAPSED
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });

  const panelRef = useRef<HTMLDivElement>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const petWrapperRef = useRef<HTMLDivElement>(null);
  const bodyLayerRef = useRef<HTMLDivElement>(null);
  const mouthLayerRef = useRef<HTMLDivElement>(null);
  const eyesLayerRef = useRef<HTMLDivElement>(null);
  const tailLayerRef = useRef<HTMLDivElement>(null);
  const eatChompTimeoutRef = useRef<number | null>(null);
  const actionRequestRef = useRef(0);
  const pendingSaveRef = useRef<{
    id: number;
    recordId: number;
    kind: "summarize" | "actions" | "remember";
    text: string;
  } | null>(null);

  const appWindow = useMemo(() => getCurrentWindow(), []);
  const activeState = useMemo(() => {
    if (isMuted) return "idle_breathe";
    return petState;
  }, [isMuted, petState]);
  const isExpanded =
    currentWindowSize.width >= WINDOW_EXPANDED.width - 1 &&
    currentWindowSize.height >= WINDOW_EXPANDED.height - 1;
  
  // Debug: log state changes (disabled for performance)
  // useEffect(() => {
  //   console.log("State update - petState:", petState, "activeState:", activeState, "isDragOver:", isDragOver);
  // }, [petState, activeState, isDragOver]);

  // Initialize CSS variable for window width
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--window-width", `${currentWindowSize.width}px`);
  }, []);

  // Track mouse position for eye following (always active)
  useEffect(() => {
    if (isMuted) {
      // Reset eye positions when muted
      const eyeElements = document.querySelectorAll('.pet-pupil');
      eyeElements.forEach((eye) => {
        const el = eye as HTMLElement;
        if (el) {
          el.style.transform = "translate(-50%, -50%)";
          el.dataset.eyeX = "0";
          el.dataset.eyeY = "0";
        }
      });
      return;
    }

    let lastMouseX: number | null = null;
    let lastMouseY: number | null = null;
    let cachedRect: DOMRect | null = null;
    let rectCacheTime = 0;
    let cachedWindowPosition: { x: number; y: number } | null = null;
    let windowPositionCacheTime = 0;
    const RECT_CACHE_DURATION = 50; // Cache rect for 50ms
    const WINDOW_POS_CACHE_DURATION = 100; // Cache window position for 100ms

    // Periodically update window position cache
    const updateWindowPositionCache = async () => {
      try {
        const position = await appWindow.innerPosition();
        cachedWindowPosition = { x: position.x, y: position.y };
        windowPositionCacheTime = performance.now();
      } catch (error) {
        // Silently fail, will retry next time
      }
    };

    // Initial cache update
    updateWindowPositionCache();
    const windowPositionUpdateInterval = setInterval(updateWindowPositionCache, WINDOW_POS_CACHE_DURATION);

    const updateEyePosition = (mouseX?: number, mouseY?: number, isGlobal = false) => {
      if (!petWrapperRef.current) {
        return;
      }
      
      // Use provided coordinates or fall back to last known position
      let currentMouseX = mouseX ?? lastMouseX;
      let currentMouseY = mouseY ?? lastMouseY;
      
      // If global coordinates, convert to window-relative coordinates
      if (isGlobal && currentMouseX !== null && currentMouseY !== null && cachedWindowPosition) {
        // Convert global screen coordinates to window-relative coordinates
        currentMouseX = currentMouseX - cachedWindowPosition.x;
        currentMouseY = currentMouseY - cachedWindowPosition.y;
      }
      
      // Don't update if we don't have valid mouse coordinates
      if (currentMouseX === null || currentMouseY === null) {
        return;
      }
      
      // Cache getBoundingClientRect to avoid frequent expensive calls
      const now = performance.now();
      if (!cachedRect || now - rectCacheTime > RECT_CACHE_DURATION) {
        cachedRect = petWrapperRef.current.getBoundingClientRect();
        rectCacheTime = now;
      }
      
      const rect = cachedRect;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const relativeX = currentMouseX - centerX;
      const relativeY = currentMouseY - centerY;
      
      // Update CSS variables for eye position (pupil movement within eye)
      const maxPupilOffset = 8; // Max movement in pixels (25% of 32px eye)
      const distance = Math.sqrt(relativeX ** 2 + relativeY ** 2);
      const maxDistance = Math.min(rect.width, rect.height) * 0.6;
      
      const eyeElements = document.querySelectorAll('.pet-pupil');
      
      if (distance > 0 && maxDistance > 0) {
        const normalizedDistance = Math.min(distance / maxDistance, 1);
        const eyeOffsetX = (relativeX / distance) * maxPupilOffset * normalizedDistance;
        const eyeOffsetY = (relativeY / distance) * maxPupilOffset * normalizedDistance;
        
        // Use anime.js for smooth eye movement
        eyeElements.forEach((eye) => {
          const el = eye as HTMLElement;
          if (el) {
            // Store current position in data attributes for anime.js
            const currentX = parseFloat(el.dataset.eyeX || "0");
            const currentY = parseFloat(el.dataset.eyeY || "0");
            
            // Animate to new position
            const target = { x: currentX, y: currentY };
            animate(target, {
              x: eyeOffsetX,
              y: eyeOffsetY,
              duration: 100,
              ease: "outQuad",
              onUpdate: () => {
                const { x, y } = target;
                el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
                el.dataset.eyeX = x.toString();
                el.dataset.eyeY = y.toString();
              }
            });
          }
        });
      } else {
        // Reset to center
        eyeElements.forEach((eye) => {
          const el = eye as HTMLElement;
          if (el) {
            el.style.transform = "translate(-50%, -50%)";
            el.dataset.eyeX = "0";
            el.dataset.eyeY = "0";
          }
        });
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
      updateEyePosition(event.clientX, event.clientY, false);
    };

    const handleDragOver = (event: DragEvent) => {
      // This is the key event - dragover fires continuously when dragging over the window
      event.preventDefault();
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
      updateEyePosition(event.clientX, event.clientY, false);
    };

    // Listen to global mouse move events from Rust backend
    let globalMouseUnlisten: (() => void) | null = null;
    let globalButtonUnlisten: (() => void) | null = null;
    let isMouseButtonPressed = false;
    
    // Cache window position and size for drag detection
    let cachedWindowPos: { x: number; y: number } | null = null;
    let cachedWindowSize: { width: number; height: number } | null = null;
    let windowCacheTime = 0;
    const WINDOW_CACHE_DURATION = 200; // Cache for 200ms
    
    const updateWindowCache = async () => {
      try {
        const [pos, size] = await Promise.all([
          appWindow.innerPosition(),
          appWindow.innerSize()
        ]);
        cachedWindowPos = { x: pos.x, y: pos.y };
        cachedWindowSize = { width: size.width, height: size.height };
        windowCacheTime = Date.now();
      } catch (error) {
        // Ignore errors
      }
    };
    
    // Initial cache update
    updateWindowCache();
    const windowCacheInterval = setInterval(updateWindowCache, WINDOW_CACHE_DURATION);
    
    listen<{ x: number; y: number; buttonPressed?: boolean }>("global-mouse-move", (event) => {
      const { x, y, buttonPressed } = event.payload;
      lastMouseX = x;
      lastMouseY = y;
      
      // Update button state if provided
      if (buttonPressed !== undefined) {
        isMouseButtonPressed = buttonPressed;
      }
      
      // Check if mouse is in window and button is pressed (dragging)
      if (isMouseButtonPressed && !isMuted && cachedWindowPos && cachedWindowSize) {
        const windowX = x - cachedWindowPos.x;
        const windowY = y - cachedWindowPos.y;
        
        if (windowX >= 0 && windowX <= cachedWindowSize.width && 
            windowY >= 0 && windowY <= cachedWindowSize.height) {
          // Mouse is in window and button is pressed = dragging
          setPetState((currentState) => {
            if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
              console.log("Detected drag in window via global mouse, setting waiting_for_drop");
              return "waiting_for_drop";
            }
            return currentState;
          });
        }
      }
      
      updateEyePosition(x, y, true);
    }).then((unlisten) => {
      globalMouseUnlisten = unlisten;
    }).catch((error) => {
      console.error("Failed to listen to global-mouse-move:", error);
    });
    
    // Listen to mouse button state changes
    listen<{ pressed: boolean }>("global-mouse-button", (event) => {
      const wasPressed = isMouseButtonPressed;
      isMouseButtonPressed = event.payload.pressed;
      console.log("Mouse button state changed:", wasPressed, "->", isMouseButtonPressed);
      
      if (!isMouseButtonPressed && wasPressed && !isMuted) {
        // Button just released, but don't reset if we're about to drop
        // The drop event will handle the state change
        setTimeout(() => {
          setPetState((currentState) => {
            // Only reset if still in waiting state (drop didn't happen)
            if (currentState === "waiting_for_drop") {
              console.log("Button released without drop, resetting");
              return "idle_breathe";
            }
            return currentState;
          });
        }, 100); // Small delay to allow drop event to fire first
      }
    }).then((unlisten) => {
      globalButtonUnlisten = unlisten;
    }).catch((error) => {
      console.error("Failed to listen to global-mouse-button:", error);
    });

    // Add event listeners - dragover is the most important for drag operations
    // It fires continuously when dragging over the window
    document.addEventListener("dragover", handleDragOver, { capture: true, passive: false });
    window.addEventListener("dragover", handleDragOver, true);
    
    // Also listen to mousemove for when mouse moves without dragging (as fallback)
    document.addEventListener("mousemove", handleMouseMove, { passive: true, capture: true });
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    
    // Initialize eye position from existing data if available
    const initializeEyePosition = () => {
      const eyeElements = document.querySelectorAll('.pet-pupil');
      eyeElements.forEach((eye) => {
        const el = eye as HTMLElement;
        if (el) {
          const currentX = parseFloat(el.dataset.eyeX || "0");
          const currentY = parseFloat(el.dataset.eyeY || "0");
          // If eyes already have position data, keep it; otherwise wait for first mouse move
          if (currentX !== 0 || currentY !== 0) {
            el.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
          }
        }
      });
    };
    
    // Initialize eye position immediately (if data exists)
    initializeEyePosition();
    
    return () => {
      // Cleanup window position update interval
      clearInterval(windowPositionUpdateInterval);
      clearInterval(windowCacheInterval);
      
      // Cleanup global mouse listeners
      if (globalMouseUnlisten) {
        globalMouseUnlisten();
      }
      if (globalButtonUnlisten) {
        globalButtonUnlisten();
      }
      
      document.removeEventListener("dragover", handleDragOver, { capture: true });
      document.removeEventListener("mousemove", handleMouseMove, { capture: true });
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("mousemove", handleMouseMove);
      
      // Reset on cleanup
      const eyeElements = document.querySelectorAll('.pet-pupil');
      eyeElements.forEach((eye) => {
        const el = eye as HTMLElement;
        if (el) {
          el.style.transform = "translate(-50%, -50%)";
          el.dataset.eyeX = "0";
          el.dataset.eyeY = "0";
        }
      });
    };
  }, [isMuted]);


  useEffect(() => {
    const appWindow = getCurrentWindow();

    const unlistenDropEvent = appWindow.onDragDropEvent((event) => {
      console.log("Tauri dragdrop event:", event.payload.type);
      
      // 处理拖拽进入事件
      if (event.payload.type === "hover" || event.payload.type === "enter") {
        if (!isMuted) {
          console.log("Tauri dragenter detected, setting waiting_for_drop");
          setPetState((currentState) => {
            if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
              return "waiting_for_drop";
            }
            return currentState;
          });
        }
        return;
      }
      
      // 处理拖拽离开事件
      if (event.payload.type === "leave" || event.payload.type === "cancelled") {
        if (!isMuted) {
          console.log("Tauri dragleave detected");
          setPetState((currentState) => {
            if (currentState === "waiting_for_drop") {
              return "idle_breathe";
            }
            return currentState;
          });
        }
        return;
      }
      
      if (event.payload.type === "drop") {
        if (!isMuted) {
          // 清除之前的 timeout（如果有）
          if (eatChompTimeoutRef.current) {
            window.clearTimeout(eatChompTimeoutRef.current);
            eatChompTimeoutRef.current = null;
          }
          // 立即设置 eat_chomp 状态，确保动画能触发
          console.log("Tauri drop detected, setting eat_chomp from", petState);
          setPetState((currentState) => {
            // 如果当前是 waiting_for_drop，转换为 eat_chomp
            if (currentState === "waiting_for_drop" || currentState === "idle_breathe") {
              return "eat_chomp";
            }
            return currentState;
          });
          // 记录 drop 开始时间
          const dropStartTime = Date.now();
          
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            void (async () => {
              try {
                const payload = await invoke<DropProcessedPayload>(
                  "process_drop_paths_command",
                  { paths }
                );
                setDropRecord(payload.record);
                setPanelVisible(true);
                setPanelLockUntil(Date.now() + 600);
                setPanelMode(null);
                setPanelText("");
                // 确保 eat_chomp 状态持续至少 1000ms（动画时长）
                // 计算已经过去的时间，确保总共持续 1000ms
                const elapsed = Date.now() - dropStartTime;
                const remaining = Math.max(1000 - elapsed, 200); // 至少再等 200ms
                eatChompTimeoutRef.current = window.setTimeout(() => {
                  setPetState("idle_breathe");
                  eatChompTimeoutRef.current = null;
                }, Math.max(remaining, 1000)); // 确保至少1000ms以匹配新的动画时长
              } catch (error) {
                console.error(error);
                // 出错时也要确保 eat_chomp 状态持续足够时间
                const elapsed = Date.now() - dropStartTime;
                const remaining = Math.max(1000 - elapsed, 200);
                eatChompTimeoutRef.current = window.setTimeout(() => {
                  setPetState("error_confused");
                  eatChompTimeoutRef.current = window.setTimeout(() => {
                    setPetState("idle_breathe");
                    eatChompTimeoutRef.current = null;
                  }, 1200);
                }, remaining);
              }
            })();
          } else {
            // 如果没有路径，也要确保 eat_chomp 状态能显示
            eatChompTimeoutRef.current = window.setTimeout(() => {
              setPetState("idle_breathe");
              eatChompTimeoutRef.current = null;
            }, 1000); // 匹配新的动画时长
          }
        }
      }
    });

    return () => {
      void unlistenDropEvent.then((f) => f());
      // 清理 eat_chomp timeout
      if (eatChompTimeoutRef.current) {
        window.clearTimeout(eatChompTimeoutRef.current);
        eatChompTimeoutRef.current = null;
      }
    };
  }, [isMuted, petState]);

  useEffect(() => {
    console.log("Setting up drag event listeners, isMuted:", isMuted);
    
    function handleDomDrag(event: DragEvent) {
      const name = event.type;
      console.log("Drag event triggered:", name, "isMuted:", isMuted);
      
      setDebugInfo((prev) => ({
        ...prev,
        lastDomDrag: name,
        domDragCount: prev.domDragCount + 1
      }));
      
      if (name === "dragenter") {
        event.preventDefault();
        console.log("dragenter: isMuted =", isMuted);
        // 当拖拽进入窗口时，进入等待状态
        // 使用函数式更新避免闭包问题
        if (!isMuted) {
          console.log("Drag enter detected, setting waiting_for_drop");
          setPetState((currentState) => {
            console.log("Current state:", currentState);
            if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
              console.log("State changed to waiting_for_drop");
              return "waiting_for_drop";
            }
            return currentState;
          });
        } else {
          console.log("Muted, not setting waiting state");
        }
      }
      if (name === "dragover") {
        event.preventDefault();
        // dragover 持续触发，确保保持等待状态
        if (!isMuted) {
          setPetState((currentState) => {
            if (currentState === "idle_breathe" || currentState === "idle_blink") {
              console.log("dragover: changing state from", currentState, "to waiting_for_drop");
              return "waiting_for_drop";
            }
            return currentState;
          });
        }
      }
      if (name === "dragleave") {
        // 当拖拽离开窗口时，恢复空闲状态
        if (!isMuted) {
          setPetState((currentState) => {
            if (currentState === "waiting_for_drop") {
              return "idle_breathe";
            }
            return currentState;
          });
        }
      }
      if (name === "drop") {
        event.preventDefault();
        // DOM drop 事件由 onDragDropEvent 处理，这里只做防御性处理
        // 如果 Tauri 事件没有触发，这里作为备用
        if (!isMuted) {
          setPetState((currentState) => {
            if (currentState !== "eat_chomp") {
              return "eat_chomp";
            }
            return currentState;
          });
          window.setTimeout(() => setPetState("idle_breathe"), 1000);
        }
      }
    }

    // 同时监听 document 和 window
    document.addEventListener("dragenter", handleDomDrag, true);
    document.addEventListener("dragover", handleDomDrag, true);
    document.addEventListener("dragleave", handleDomDrag, true);
    document.addEventListener("drop", handleDomDrag, true);
    
    window.addEventListener("dragenter", handleDomDrag, true);
    window.addEventListener("dragover", handleDomDrag, true);
    window.addEventListener("dragleave", handleDomDrag, true);
    window.addEventListener("drop", handleDomDrag, true);
    
    console.log("Drag event listeners added to both document and window");

    return () => {
      document.removeEventListener("dragenter", handleDomDrag, true);
      document.removeEventListener("dragover", handleDomDrag, true);
      document.removeEventListener("dragleave", handleDomDrag, true);
      document.removeEventListener("drop", handleDomDrag, true);
      
      window.removeEventListener("dragenter", handleDomDrag, true);
      window.removeEventListener("dragover", handleDomDrag, true);
      window.removeEventListener("dragleave", handleDomDrag, true);
      window.removeEventListener("drop", handleDomDrag, true);
    };
  }, [isMuted]);

  useEffect(() => {
    const unlistenResize = appWindow.onResized(async () => {
      try {
        const size = await appWindow.innerSize();
        setCurrentWindowSize({ width: size.width, height: size.height });
      } catch (error) {
        setDebugInfo((prev) => ({
          ...prev,
          lastResize: "error"
        }));
      }
    });

    return () => {
      void unlistenResize.then((f) => f());
    };
  }, [appWindow]);

  // 监听 eat_chomp 状态，触发吃动画
  useEffect(() => {
    if (petState === "eat_chomp" && !isMuted) {
      triggerEatAnimation();
    }
  }, [petState, isMuted]);

  // 监听 waiting_for_drop 状态，触发等待动画
  useEffect(() => {
    console.log("petState changed to:", petState, "isMuted:", isMuted);
    if (petState === "waiting_for_drop" && !isMuted) {
      console.log("Triggering waiting animation");
      triggerWaitingAnimation();
    } else if (petState !== "waiting_for_drop" && mouthLayerRef.current) {
      // 当离开等待状态时，恢复线条并隐藏椭圆，恢复40px尺寸
      const mouth = mouthLayerRef.current;
      const svg = mouth.querySelector('svg');
      const svgPath = mouth.querySelector('path');
      const ellipse = mouth.querySelector('ellipse');
      
      // 恢复SVG到正常40px尺寸
      if (svg) {
        svg.setAttribute('width', '40');
        svg.setAttribute('height', '8');
        svg.setAttribute('viewBox', '0 0 40 8');
        (svg as HTMLElement).style.width = '40px';
        (svg as HTMLElement).style.height = '8px';
      }
      mouth.style.setProperty('--mouth-width', '40px');
      mouth.style.setProperty('--mouth-height', '8px');
      mouth.style.width = '40px';
      mouth.style.height = '8px';
      
      if (svgPath) {
        svgPath.style.display = '';
        svgPath.setAttribute('d', 'M 2 2 Q 20 7 38 2'); // 恢复正常的path
      }
      if (ellipse) {
        ellipse.style.display = 'none';
      }
    }
  }, [petState, isMuted]);

  useEffect(() => {
    if (isMuted) return;

    function scheduleBlink() {
      idleTimeoutRef.current = window.setTimeout(() => {
        if (petState === "idle_breathe") {
          setPetState("idle_blink");
          window.setTimeout(() => setPetState("idle_breathe"), 300);
        }
        scheduleBlink();
      }, getRandomBlinkDelay());
    }

    scheduleBlink();

    return () => {
      if (idleTimeoutRef.current) {
        window.clearTimeout(idleTimeoutRef.current);
      }
    };
  }, [petState, isMuted]);

  useEffect(() => {
    if (!panelVisible) return;
    const timer = window.setTimeout(() => {
      setPanelVisible(false);
      setPanelMode(null);
      setPanelText("");
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [panelVisible]);

  useOutsideClick(panelRef, () => {
    if (panelVisible) {
      if (Date.now() < panelLockUntil) return;
      setPanelVisible(false);
      setPanelMode(null);
      setPanelText("");
    }
  });

  useEffect(() => {
    // Determine target window size based on state
    let next;
    if (panelVisible) {
      next = WINDOW_EXPANDED; // Full expansion when panel is visible
    } else {
      next = WINDOW_COLLAPSED; // Collapsed when idle
    }
    
    // Only resize if size actually changed
    if (currentWindowSize.width === next.width && currentWindowSize.height === next.height) {
      return;
    }

    // Update CSS variable immediately for smooth visual transition
    const root = document.documentElement;
    root.style.setProperty("--window-width", `${next.width}px`);

    // Use CSS transition for visual smoothness, only call Rust at start and end
    // Immediate resize to target for instant response, then smooth transition
    void invoke("set_window_size", { width: next.width, height: next.height }).catch((error) => {
      setDebugInfo((prev) => ({
        ...prev,
        lastResize: "error"
      }));
    });

    setCurrentWindowSize(next);
    setDebugInfo((prev) => ({
      ...prev,
      lastResize: `${next.width}x${next.height}`
    }));
  }, [panelVisible, currentWindowSize]);

  // Update CSS variable on window resize
  useEffect(() => {
    const updateWindowWidth = () => {
      const root = document.documentElement;
      root.style.setProperty("--window-width", `${currentWindowSize.width}px`);
    };
    updateWindowWidth();
  }, [currentWindowSize]);

  useEffect(() => {
    function handleWindowClick() {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    }

    window.addEventListener("pointerdown", handleWindowClick);
    return () => window.removeEventListener("pointerdown", handleWindowClick);
  }, [contextMenu.visible]);

  function triggerEatAnimation() {
    if (!petWrapperRef.current || !bodyLayerRef.current || !mouthLayerRef.current || !eyesLayerRef.current || !tailLayerRef.current) return;

    const wrapper = petWrapperRef.current;
    const body = bodyLayerRef.current;
    const mouth = mouthLayerRef.current;
    const eyes = eyesLayerRef.current;
    const tail = tailLayerRef.current;
    const pupils = eyes.querySelectorAll('.pet-pupil');

    // 重置到初始状态
    const resetToInitial = () => {
      // 确保 transform 完全重置，不使用 scale
      // 身体保持不动，只重置嘴巴和眼睛
      wrapper.style.transform = "translate(0px, 0px) rotate(0deg)";
      animate(body, {
        rotate: 0,
        duration: 0
      });
      // 重置嘴巴到初始状态（简单线条风格）- 向下弯曲的微笑
      mouth.style.setProperty('--mouth-stroke-width', '3px');
      mouth.style.setProperty('--mouth-width', '40px');
      mouth.style.setProperty('--mouth-curve', '7px');
      const svgPath = mouth.querySelector('path');
      const ellipse = mouth.querySelector('ellipse');
      const svg = mouth.querySelector('svg');
      
      // 恢复SVG到正常尺寸
      if (svg) {
        svg.setAttribute('width', '40');
        svg.setAttribute('height', '8');
        svg.setAttribute('viewBox', '0 0 40 8');
      }
      
      // 显示线条，隐藏椭圆
      if (svgPath) {
        svgPath.style.display = '';
        svgPath.setAttribute('d', 'M 2 2 Q 20 7 38 2'); // 向下弯曲的微笑
        svgPath.setAttribute('stroke-width', '3');
      }
      if (ellipse) {
        ellipse.style.display = 'none';
      }
      animate(tail, {
        rotate: 25,
        duration: 0
      });
      pupils.forEach((pupil) => {
        const el = pupil as HTMLElement;
        const currentX = parseFloat(el.dataset.eyeX || "0");
        const currentY = parseFloat(el.dataset.eyeY || "0");
        el.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
      });
    };

    // 吃动画序列
    // 1. 准备阶段：眼睛向下看，嘴巴大张（身体保持不动）
    // 注意：不使用 scale，确保大小不变
    // 眼睛向下看（看着食物，幅度更大）
    pupils.forEach((pupil) => {
      const el = pupil as HTMLElement;
      const currentX = parseFloat(el.dataset.eyeX || "0");
      const currentY = parseFloat(el.dataset.eyeY || "0");
      const target = { y: currentY };
      animate(target, {
        y: 10, // 增加眼睛向下看的幅度
        duration: 180,
        ease: "outQuad",
        update: () => {
          const y = target.y;
          el.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${y}px))`;
          el.dataset.eyeY = y.toString();
        }
      });
    });

    // 嘴巴稍微张开（简单线条风格）
    // 使用 SVG path 绘制向下弯曲的微笑线条
    const svgPath = mouth.querySelector('path');
    const mouthAnim = { strokeWidth: 3, width: 40, curve: 7 };
    // 初始化：向下弯曲的微笑 (M 2 2 Q 20 7 38 2) - 控制点y值越大，向下弯曲越明显（但要在viewBox范围内）
    if (svgPath) {
      svgPath.setAttribute('d', `M 2 2 Q 20 ${mouthAnim.curve} 38 2`);
      svgPath.setAttribute('stroke-width', `${mouthAnim.strokeWidth}`);
    }
    mouth.style.setProperty('--mouth-width', `${mouthAnim.width}px`);
    animate(mouthAnim, {
      strokeWidth: 5,
      width: 45,
      curve: 7, // 保持一致的弯曲度
      duration: 180,
      ease: "outQuad",
      update: () => {
        // 更新 SVG path - 向下弯曲的微笑
        if (svgPath) {
          svgPath.setAttribute('d', `M 2 2 Q 20 ${mouthAnim.curve} 38 2`);
          svgPath.setAttribute('stroke-width', `${mouthAnim.strokeWidth}`);
        }
        mouth.style.setProperty('--mouth-width', `${mouthAnim.width}px`);
      }
    });

    // 2. 咀嚼阶段：嘴巴快速开合5次
    window.setTimeout(() => {
      // 嘴巴咀嚼动画（开合5次，简单线条风格）
      // 使用共享的动画对象，确保状态连续
      const svgPath = mouth.querySelector('path');
      const mouthAnim = { strokeWidth: 5, width: 45, curve: 7 };
      let chompCount = 0;
      const maxChomps = 5; // 5次开合
      
      const chomp = () => {
        if (chompCount >= maxChomps) {
          // 所有咀嚼完成
          return;
        }
        chompCount++;
        
        // 从当前状态切换到相反状态
        // 如果当前是张开(5px)，则闭合(3px)；如果当前是闭合(3px)，则张开(5px)
        const isCurrentlyOpen = mouthAnim.strokeWidth >= 4;
        const targetStrokeWidth = isCurrentlyOpen ? 3 : 5;
        const targetWidth = isCurrentlyOpen ? 40 : 45;
        const targetCurve = 7; // 保持一致的弯曲度
        
        // 从当前状态动画到目标状态，使用更柔和的缓动
        animate(mouthAnim, {
          strokeWidth: targetStrokeWidth,
          width: targetWidth,
          curve: targetCurve,
          duration: 120, // 稍微慢一点，更柔和
          ease: "easeOutQuad", // 更柔和的缓动函数
          update: () => {
            // 更新 CSS 变量和 SVG - 向下弯曲的微笑
            mouth.style.setProperty('--mouth-stroke-width', `${mouthAnim.strokeWidth}px`);
            mouth.style.setProperty('--mouth-width', `${mouthAnim.width}px`);
            mouth.style.setProperty('--mouth-curve', `${mouthAnim.curve}px`);
            if (svgPath) {
              svgPath.setAttribute('d', `M 2 2 Q 20 ${mouthAnim.curve} 38 2`);
              svgPath.setAttribute('stroke-width', `${mouthAnim.strokeWidth}`);
            }
          },
          complete: () => {
            // 继续下一次开合
            if (chompCount < maxChomps) {
              chomp();
            }
          }
        });
      };
      
      // 开始第一次咀嚼（从张开状态闭合）
      chomp();

      // 身体保持不动，只让嘴巴和眼睛动
      // 尾巴可以轻微摆动增加生动感（更柔和的摆动）
      animate(tail, {
        rotate: [25, 32, 20, 30, 22, 28, 25], // 更柔和的摆动幅度
        duration: 800,
        ease: "easeInOutSine" // 更柔和的缓动
      });
    }, 180);

    // 3. 完成阶段：恢复初始状态（延长到1000ms以匹配新的动画时长）
    window.setTimeout(() => {
      resetToInitial();
    }, 1000);
  }

  function triggerWaitingAnimation() {
    console.log("triggerWaitingAnimation called");
    if (!petWrapperRef.current || !bodyLayerRef.current || !mouthLayerRef.current || !eyesLayerRef.current || !tailLayerRef.current) {
      console.log("Missing refs, cannot trigger animation");
      return;
    }
    console.log("All refs available, starting animation");

    const wrapper = petWrapperRef.current;
    const body = bodyLayerRef.current;
    const mouth = mouthLayerRef.current;
    const eyes = eyesLayerRef.current;
    const tail = tailLayerRef.current;
    const pupils = eyes.querySelectorAll('.pet-pupil');

    // 等待状态：嘴巴张开，眼睛期待地看着
    // 眼睛稍微向下看（期待食物）
    pupils.forEach((pupil) => {
      const el = pupil as HTMLElement;
      const currentX = parseFloat(el.dataset.eyeX || "0");
      const currentY = parseFloat(el.dataset.eyeY || "0");
      const target = { y: currentY };
      animate(target, {
        y: 6, // 稍微向下看，期待的样子
        duration: 300,
        ease: "outQuad",
        update: () => {
          const y = target.y;
          el.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${y}px))`;
          el.dataset.eyeY = y.toString();
        }
      });
    });

    // 嘴巴张开等待 - 使用椭圆O形状（更可爱，100px大嘴巴）
    const svg = mouth.querySelector('svg');
    const svgPath = mouth.querySelector('path');
    
    if (!svg) {
      console.error("SVG element not found in mouth");
      return;
    }
    
    // 将SVG调整为100px大尺寸（仅等待状态）
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '30');
    svg.setAttribute('viewBox', '0 -8 100 30');
    mouth.style.setProperty('--mouth-width', '100px');
    mouth.style.setProperty('--mouth-height', '30px');
    mouth.style.width = '100px';
    mouth.style.height = '30px';
    // 确保SVG元素本身也设置尺寸
    (svg as HTMLElement).style.width = '100px';
    (svg as HTMLElement).style.height = '30px';
    
    // 隐藏原来的线条
    if (svgPath) {
      svgPath.style.display = 'none';
    }
    
    // 停止之前的动画（如果有）
    if ((mouth as any).__waitingAnimation) {
      try {
        (mouth as any).__waitingAnimation.pause();
      } catch (e) {
        // 忽略错误
      }
    }
    
    // 检查是否已有椭圆，如果没有则创建
    let ellipse = mouth.querySelector('ellipse') as SVGEllipseElement | null;
    if (!ellipse) {
      console.log("Creating new ellipse element");
      ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse') as SVGEllipseElement;
      svg.appendChild(ellipse);
      ellipse.setAttribute('fill', 'none');
      ellipse.setAttribute('stroke', '#5C4033');
      ellipse.setAttribute('stroke-linecap', 'round');
    } else {
      console.log("Ellipse element already exists");
    }
    
    if (ellipse) {
      console.log("Ellipse found/created, setting up animation");
      // 确保椭圆可见（每次进入等待状态时都重新显示）
      ellipse.style.display = '';
      ellipse.style.visibility = 'visible';
      ellipse.style.opacity = '1';
      ellipse.removeAttribute('display'); // 移除可能的 display 属性
      
      // 设置椭圆的初始属性 - 可爱的大嘴巴（100px宽度）
      // viewBox: "0 -8 100 30" 意味着 X: 0-100, Y: -8到22
      // 椭圆应该完全居中在viewBox中
      const centerX = 50; // SVG viewBox 中心X (100/2 = 50) - 完全居中
      const centerY = 7; // SVG viewBox 中心Y ((-8 + 22) / 2 = 7) - 完全居中
      const mouthAnim = { rx: 48, ry: 12, strokeWidth: 5 }; // rx 横向半径，ry 纵向半径（rx*2=96px，接近100px，留一点边距）
      
      console.log("Setting ellipse:", {
        viewBox: svg.getAttribute('viewBox'),
        svgWidth: svg.getAttribute('width'),
        svgHeight: svg.getAttribute('height'),
        centerX,
        centerY,
        rx: mouthAnim.rx,
        ry: mouthAnim.ry,
        totalWidth: mouthAnim.rx * 2,
        totalHeight: mouthAnim.ry * 2,
        ellipseLeft: centerX - mouthAnim.rx,
        ellipseRight: centerX + mouthAnim.rx
      });
      
      // 立即设置属性，确保可见
      ellipse.setAttribute('cx', centerX.toString());
      ellipse.setAttribute('cy', centerY.toString());
      ellipse.setAttribute('rx', mouthAnim.rx.toString());
      ellipse.setAttribute('ry', mouthAnim.ry.toString());
      ellipse.setAttribute('stroke-width', mouthAnim.strokeWidth.toString());
      
      console.log("Ellipse attributes set:", {
        cx: ellipse.getAttribute('cx'),
        cy: ellipse.getAttribute('cy'),
        rx: ellipse.getAttribute('rx'),
        ry: ellipse.getAttribute('ry'),
        totalWidth: (parseFloat(ellipse.getAttribute('rx') || '0') * 2),
        display: ellipse.style.display
      });
      
      // 嘴巴轻微开合动画（等待时的呼吸感）- 椭圆变大变小，更明显的动画
      const animation = animate(mouthAnim, {
        rx: [48, 50, 48],
        ry: [12, 14, 12],
        strokeWidth: [5, 5.5, 5],
        duration: 1500,
        ease: "easeInOutSine",
        loop: true,
        update: () => {
          if (ellipse && ellipse.parentNode) {
            ellipse.setAttribute('rx', mouthAnim.rx.toString());
            ellipse.setAttribute('ry', mouthAnim.ry.toString());
            ellipse.setAttribute('stroke-width', mouthAnim.strokeWidth.toString());
          }
        }
      });
      
      // 存储动画引用以便后续清理
      (mouth as any).__waitingAnimation = animation;
      console.log("Animation started and stored");
    } else {
      console.error("Failed to create or find ellipse element, svg:", svg);
    }

    // 尾巴轻微摆动（期待的样子）
    animate(tail, {
      rotate: [25, 30, 20, 25],
      duration: 1200,
      ease: "easeInOutSine",
      loop: true
    });
  }

  function triggerExpressionAnimation(kind: "summarize" | "actions" | "remember") {
    if (!petWrapperRef.current || !bodyLayerRef.current || !mouthLayerRef.current || !eyesLayerRef.current || !tailLayerRef.current) return;

    const wrapper = petWrapperRef.current;
    const body = bodyLayerRef.current;
    const mouth = mouthLayerRef.current;
    const eyes = eyesLayerRef.current;
    const tail = tailLayerRef.current;
    const pupils = eyes.querySelectorAll('.pet-pupil');

    // 重置所有动画
    const resetAll = () => {
      // 确保 transform 完全重置，不使用 scale
      wrapper.style.transform = "translateY(0px)";
      animate(wrapper, {
        rotate: 0,
        translateX: 0,
        translateY: 0,
        duration: 0
      });
      animate(body, {
        rotate: 0,
        duration: 0
      });
      animate(mouth, {
        scaleX: 1,
        scaleY: 1,
        translateY: 0,
        duration: 0
      });
      // 确保嘴巴恢复为线条（隐藏椭圆，显示线条）
      const svgPath = mouth.querySelector('path');
      const ellipse = mouth.querySelector('ellipse');
      if (svgPath) {
        svgPath.style.display = '';
      }
      if (ellipse) {
        ellipse.style.display = 'none';
      }
      animate(tail, {
        rotate: 25,
        duration: 0
      });
      pupils.forEach((pupil) => {
        const el = pupil as HTMLElement;
        animate(el, {
          translateX: 0,
          translateY: 0,
          scale: 1,
          duration: 0
        });
      });
      const eyeElements = eyes.querySelectorAll('.pet-eye');
      eyeElements.forEach((eye) => {
        const el = eye as HTMLElement;
        animate(el, {
          scaleY: 1,
          duration: 0
        });
      });
    };

    if (kind === "summarize") {
      // 总结：思考表情 - 眼睛向上看，嘴巴稍微张开，身体轻微前倾
      resetAll();
      
      // 眼睛向上看
      pupils.forEach((pupil) => {
        const el = pupil as HTMLElement;
        const currentY = parseFloat(el.dataset.eyeY || "0");
        const target = { y: currentY };
        animate(target, {
          y: -6,
          duration: 300,
          ease: "outQuad",
          update: () => {
            const y = target.y;
            el.style.transform = `translate(calc(-50% + 0px), calc(-50% + ${y}px))`;
            el.dataset.eyeY = y.toString();
          }
        });
      });

      // 嘴巴稍微张开（思考状）
      animate(mouth, {
        scaleY: 1.3,
        scaleX: 0.9,
        translateY: -2,
        duration: 300,
        ease: "outQuad"
      });

      // 身体轻微前倾（不使用 scale，确保大小不变）
      animate(wrapper, {
        translateY: 3,
        duration: 300,
        ease: "outQuad"
      });

      // 尾巴轻微摆动
      animate(tail, {
        rotate: [25, 30, 20, 25],
        duration: 800,
        ease: "inOutQuad",
        loop: true
      });

    } else if (kind === "actions") {
      // 提取待办：专注表情 - 眼睛聚焦，身体稍微放大，嘴巴紧闭
      resetAll();
      
      // 眼睛聚焦（瞳孔稍微放大）
      pupils.forEach((pupil) => {
        const el = pupil as HTMLElement;
        const currentX = parseFloat(el.dataset.eyeX || "0");
        const currentY = parseFloat(el.dataset.eyeY || "0");
        const target = { scale: 1 };
        animate(target, {
          scale: 1.15,
          duration: 250,
          ease: "outQuad",
          update: () => {
            const scale = target.scale;
            el.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px)) scale(${scale})`;
          }
        });
      });

      // 嘴巴紧闭（专注状）
      animate(mouth, {
        scaleY: 0.7,
        scaleX: 1.1,
        duration: 250,
        ease: "outQuad"
      });

      // 身体兴奋（不使用 scale，确保大小不变）
      // 可以通过其他方式表达兴奋，比如轻微抖动
      animate(wrapper, {
        translateY: [0, 2, 0],
        duration: 250,
        ease: "outQuad"
      });

      // 尾巴快速摆动
      animate(tail, {
        rotate: [25, 35, 15, 25],
        duration: 600,
        ease: "inOutQuad",
        loop: true
      });

    } else if (kind === "remember") {
      // 记住：开心表情 - 眼睛眯起来，嘴巴微笑，身体轻微摇摆
      resetAll();
      
      // 眼睛眯起来（向上移动并缩小）
      pupils.forEach((pupil) => {
        const el = pupil as HTMLElement;
        const currentY = parseFloat(el.dataset.eyeY || "0");
        const currentX = parseFloat(el.dataset.eyeX || "0");
        const target = { y: currentY, scale: 1 };
        animate(target, {
          y: -4,
          scale: 0.85,
          duration: 350,
          ease: "outQuad",
          update: () => {
            const y = target.y;
            const scale = target.scale;
            el.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${y}px)) scale(${scale})`;
            el.dataset.eyeY = y.toString();
          }
        });
      });

      // 眼睛整体缩小（眯眼效果）
      const eyeElements = eyes.querySelectorAll('.pet-eye');
      eyeElements.forEach((eye) => {
        const el = eye as HTMLElement;
        animate(el, {
          scaleY: 0.6,
          duration: 350,
          ease: "outQuad"
        });
      });

      // 嘴巴微笑（向上弯曲）
      animate(mouth, {
        scaleY: 0.8,
        scaleX: 1.2,
        translateY: -3,
        duration: 350,
        ease: "outQuad"
      });

      // 身体开心摇摆（不使用 scale，确保大小不变）
      animate(wrapper, {
        rotate: [0, 3, -3, 0],
        duration: 600,
        ease: "inOutQuad",
        loop: true
      });

      // 尾巴快速摆动
      animate(tail, {
        rotate: [25, 40, 10, 25],
        duration: 500,
        ease: "inOutQuad",
        loop: true
      });
    }
  }

  function handleAction(kind: "summarize" | "actions" | "remember") {
    if (!dropRecord) return;
    actionRequestRef.current += 1;
    const requestId = actionRequestRef.current;
    setPanelMode(kind);
    setPetState("thinking");
    
    // 触发对应选项的表情动画
    triggerExpressionAnimation(kind);
    
    void (async () => {
      const nextText = await getResponseText(kind);
      if (requestId !== actionRequestRef.current) return;
      setPanelText(nextText);
      setStreamKey(requestId);
      pendingSaveRef.current = {
        id: requestId,
        recordId: dropRecord.id,
        kind,
        text: nextText
      };
    })();
  }

  function handleStreamComplete(streamId: number) {
    const pending = pendingSaveRef.current;
    if (pending && pending.id === streamId && pending.recordId > 0) {
      void invoke("save_mock_result", {
        recordId: pending.recordId,
        kind: pending.kind,
        content: pending.text
      });
    }
    
    // 重置所有动画到初始状态
    if (petWrapperRef.current && bodyLayerRef.current && mouthLayerRef.current && eyesLayerRef.current && tailLayerRef.current) {
      const wrapper = petWrapperRef.current;
      const body = bodyLayerRef.current;
      const mouth = mouthLayerRef.current;
      const eyes = eyesLayerRef.current;
      const tail = tailLayerRef.current;
      const pupils = eyes.querySelectorAll('.pet-pupil');
      const eyeElements = eyes.querySelectorAll('.pet-eye');

      // 重置所有元素（不使用 scale，确保大小不变）
      wrapper.style.transform = "translateY(0px)";
      animate(wrapper, {
        rotate: 0,
        translateX: 0,
        translateY: 0,
        duration: 400,
        ease: "outQuad"
      });
      animate(body, {
        rotate: 0,
        duration: 400,
        ease: "outQuad"
      });
      animate(mouth, {
        scaleX: 1,
        scaleY: 1,
        translateY: 0,
        duration: 400,
        ease: "outQuad"
      });
      animate(tail, {
        rotate: 25,
        duration: 400,
        ease: "outQuad"
      });
      pupils.forEach((pupil) => {
        const el = pupil as HTMLElement;
        const currentY = parseFloat(el.dataset.eyeY || "0");
        const currentX = parseFloat(el.dataset.eyeX || "0");
        const target = { x: currentX, y: currentY, scale: 1 };
        animate(target, {
          x: 0,
          y: 0,
          scale: 1,
          duration: 400,
          ease: "outQuad",
          update: () => {
            const x = target.x;
            const y = target.y;
            const scale = target.scale;
            el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
            el.dataset.eyeX = x.toString();
            el.dataset.eyeY = y.toString();
          }
        });
      });
      eyeElements.forEach((eye) => {
        const el = eye as HTMLElement;
        animate(el, {
          scaleY: 1,
          duration: 400,
          ease: "outQuad"
        });
      });
    }
    
    setPetState("success_happy");
    window.setTimeout(() => setPetState("idle_breathe"), 1200);
  }

  return (
    <div
      className={`app-root state-${activeState}`}
      onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-no-drag]")) return;
        if (target.closest(".pet-wrapper")) {
          event.preventDefault();
          void appWindow.startDragging();
        }
      }}
      onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        // 不要阻止事件传播，让 window 监听器也能收到
        // event.stopPropagation();
      }}
      onDragEnter={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        // 触发等待状态
        if (!isMuted) {
          setPetState((currentState) => {
            if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
              return "waiting_for_drop";
            }
            return currentState;
          });
        }
      }}
      onDragLeave={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        // 只有当真正离开窗口时才恢复（避免子元素触发）
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const x = event.clientX;
        const y = event.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          if (!isMuted) {
            setPetState((currentState) => {
              if (currentState === "waiting_for_drop") {
                return "idle_breathe";
              }
              return currentState;
            });
          }
        }
      }}
      onDrop={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        // DOM drop 事件由 onDragDropEvent 处理，这里只做防御性处理
        // 如果 Tauri 事件没有触发，这里作为备用
        if (!isMuted && petState !== "eat_chomp") {
          setPetState("eat_chomp");
          window.setTimeout(() => setPetState("idle_breathe"), 900);
        }
      }}
      onContextMenu={(event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, visible: true });
      }}
    >
      <div
        className={`pet-stage ${panelVisible ? "panel-open" : ""} ${
          panelVisible && !isExpanded ? "panel-fallback" : ""
        }`}
      >
        <div className="pet-drag-hint">Drop files here</div>
        <div
          ref={petWrapperRef}
          className="pet-wrapper"
        >
          <div className="pet-layer body" ref={bodyLayerRef} />
          <div className="pet-layer tail" ref={tailLayerRef} />
          <div className={`pet-layer eyes ${activeState}`} ref={eyesLayerRef}>
            <div className="pet-eye pet-eye-left">
              <div className="pet-pupil" />
            </div>
            <div className="pet-eye pet-eye-right">
              <div className="pet-pupil" />
            </div>
          </div>
          <div className={`pet-layer mouth ${activeState}`} ref={mouthLayerRef}>
            <svg
              width="40"
              height="8"
              viewBox="0 0 40 8"
              style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}
            >
              <path
                d="M 2 2 Q 20 7 38 2"
                stroke="#5C4033"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
        {panelVisible && (
          <div className={`bubble-panel`} ref={panelRef} data-no-drag>
            <div className="bubble-header">
              <span>File received</span>
              {dropRecord && (
                <span className="bubble-meta">
                  {dropRecord.path.split(/[\\/]/).pop()}
                </span>
              )}
            </div>
            {panelVisible && (
              <>
                <div className="bubble-actions">
                  <button onClick={() => handleAction("summarize")}>
                    Summarize
                  </button>
                  <button onClick={() => handleAction("actions")}>
                    Extract action items
                  </button>
                  <button onClick={() => handleAction("remember")}>Remember</button>
                </div>
                {panelMode && (
                  <div className="bubble-output">
                    <StreamingText
                      key={streamKey}
                      text={panelText}
                      speedMs={22}
                      onComplete={() => handleStreamComplete(streamKey)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="state-label">{activeState}</div>
      <div className="pet-controls">
        <button
          className="mute-toggle"
          data-no-drag
          onClick={() => setIsMuted((prev) => !prev)}
        >
          {isMuted ? "Wake" : "Sleep"}
        </button>
        <button
          className="debug-toggle"
          data-no-drag
          onClick={() => setShowDebugControls((prev) => !prev)}
        >
          {showDebugControls ? "Hide" : "Show"} states
        </button>
        <button
          className="debug-toggle"
          data-no-drag
          onClick={() => {
            setDropRecord({
              id: 0,
              path: "demo.txt",
              hash: "demo-hash",
              createdAt: Date.now()
            });
            setPanelVisible(true);
            setPanelLockUntil(Date.now() + 600);
            setPanelMode(null);
            setPanelText("");
            setPetState("eat_chomp");
            window.setTimeout(() => setPetState("idle_breathe"), 1000);
          }}
        >
          Demo drop
        </button>
        <button
          className="debug-toggle"
          data-no-drag
          onClick={() => {
            console.log("Manual trigger: setting waiting_for_drop");
            setPetState("waiting_for_drop");
            // 不自动重置，让用户手动测试
          }}
        >
          Test waiting
        </button>
      </div>

      

      <div className="pet-debug">
        <div>
          {dropRecord ? `Last file: ${dropRecord.hash.slice(0, 10)}...` : ""}
        </div>
        <div className="pet-debug-line">
          DOM drag: {debugInfo.lastDomDrag} ({debugInfo.domDragCount})
        </div>
        <div className="pet-debug-line">Resize: {debugInfo.lastResize}</div>
        <div className="pet-debug-line">
          Panel: {panelVisible ? "open" : "closed"}
        </div>
        <div className="pet-debug-line">
          Window: {currentWindowSize.width}x{currentWindowSize.height}
        </div>
      </div>

      {showDebugControls && (
        <div className="state-controls" data-no-drag>
          {(
            [
              "idle_breathe",
              "idle_blink",
              "waiting_for_drop",
              "eat_chomp",
              "thinking",
              "success_happy",
              "error_confused"
            ] as PetState[]
          ).map((state) => (
            <button
              key={state}
              onClick={() => setPetState(state)}
              className={state === petState ? "active" : ""}
            >
              {state}
            </button>
          ))}
        </div>
      )}

      {contextMenu.visible && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-no-drag
        >
          <button onClick={() => setIsMuted((prev) => !prev)}>
            {isMuted ? "Wake" : "Sleep"}
          </button>
          <button
            onClick={async () => {
              await invoke("hide_for", { ms: 10000 });
            }}
          >
            Hide 10s
          </button>
          <button onClick={() => void appWindow.close()}>Quit</button>
        </div>
      )}

      <div className="pet-assets" aria-hidden>
        <img src={PET_LAYER_SRC} alt="" />
      </div>
    </div>
  );
}


