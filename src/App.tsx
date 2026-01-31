import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { gsap } from "gsap";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";

// Import from new modules
import type {
  PetState,
  BehaviorAnalysis,
  UserMood,
  LlmSettings,
  TimelineEventWithAttachments,
  Reminder,
  ReminderDuePayload,
  WindowSize,
} from "./types";

import {
  PET_LAYER_SRC,
  USE_MOCK,
  MOOD_CHECK_INTERVAL,
  CONVERSATION_COOLDOWN,
  DEFAULT_LLM_SETTINGS,
  LLM_MODELS,
  WINDOW_COLLAPSED,
  WINDOW_SIZES,
  getRandomBlinkDelay,
} from "./constants";

import {
  saveDroppedFile,
  listEvents,
  listPendingReminders,
  getSetting,
  setSetting,
  generateDailyExport,
  openExportFolder,
  callLlmApi,
  searchForRag,
} from "./services/api";

import {
  formatLocalDate,
  getFileDisplayName,
  isImageFile,
} from "./utils/helpers";

import { useLlmSettings, useReminder, usePapaSpace, useRecordPanel, useExportSettings } from "./hooks";
import {
  ContextMenu,
  ReminderToast,
  RecordPanel,
  SettingsPanel,
  PapaSpacePanel,
} from "./components";

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

export default function App() {
  const [petState, setPetState] = useState<PetState>("idle_breathe");
  const [panelVisible, setPanelVisible] = useState(false);
  const [dropRecord, setDropRecord] = useState<DropRecord | null>(null);
  const [panelLockUntil, setPanelLockUntil] = useState(0);
  const [currentWindowSize, setCurrentWindowSize] = useState(
    WINDOW_COLLAPSED
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });
  const [behaviorAnalysis, setBehaviorAnalysis] = useState<BehaviorAnalysis | null>(null);
  const [userMood, setUserMood] = useState<UserMood>(null);
  const [conversationBubble, setConversationBubble] = useState<ConversationBubble | null>(null);
  const [lastConversationTime, setLastConversationTime] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  // LLM Settings (extracted to hook)
  const { llmSettings, updateSettings: updateLlmSettings, updateProvider: updateLlmProvider } = useLlmSettings();

  const [chatDialogVisible, setChatDialogVisible] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // ============ Record Panel State (Phase 2) - extracted to hook ============
  const recordPanel = useRecordPanel();

  // ============ Reminder Toast State (Phase 3) - extracted to hook ============
  const reminder = useReminder();

  // ============ Papa Space State (Phase 4) - extracted to hook ============
  const papaSpace = usePapaSpace();

  // ============ Export Settings ============
  const { exportSettings, selectExportFolder, resetToDefault: resetExportPath } = useExportSettings();

  const panelRef = useRef<HTMLDivElement>(null);
  const idleTimeoutRef = useRef<number | null>(null);
  const petWrapperRef = useRef<HTMLDivElement>(null);
  const bodyLayerRef = useRef<HTMLDivElement>(null);
  const mouthLayerRef = useRef<SVGGElement>(null);
  const eyesLayerRef = useRef<SVGGElement>(null);
  const tailLayerRef = useRef<HTMLDivElement>(null);
  const gsapStateRef = useRef<{
    resetToNeutral: () => void;
    startIdleLoops: () => void;
    setState: (state: string) => void;
    playEat: () => void;
  } | null>(null);
  const isBlinkingRef = useRef(false);
  const eatChompTimeoutRef = useRef<number | null>(null);
  const successHappyTimeoutRef = useRef<number | null>(null);
  const petClickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const appWindow = useMemo(() => getCurrentWindow(), []);
  const activeState = petState;
  // Window is expanded if larger than collapsed size
  const isExpanded = currentWindowSize.width > WINDOW_COLLAPSED.width;
  
  // Debug: log state changes (disabled for performance)
  // useEffect(() => {
  //   console.log("State update - petState:", petState, "activeState:", activeState, "isDragOver:", isDragOver);
  // }, [petState, activeState, isDragOver]);

  // Initialize CSS variables for window size
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--window-width", `${currentWindowSize.width}px`);
    root.style.setProperty("--window-height", `${currentWindowSize.height}px`);
  }, []);

  // Track mouse position for eye following (always active)
  useEffect(() => {
    const shouldFollowMouse =
      petState === "idle_breathe" ||
      petState === "idle_blink" ||
      petState === "idle" ||
      petState === "waiting_for_drop" ||
      petState === "drool" ||
      petState === "eat_chomp" ||
      petState === "eat_action";

    if (!shouldFollowMouse) {
      // 不在这里重置眼睛位置，让状态动画来控制
      // 状态动画中的 resetToNeutral 会处理眼睛位置
      return;
    }
    if (isBlinkingRef.current) {
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
      // 直接操作 #eyeL 和 #eyeR（与 gsap_example.html 保持一致）
      const eyeL = bodyLayerRef.current?.querySelector("#eyeL") as SVGElement | null;
      const eyeR = bodyLayerRef.current?.querySelector("#eyeR") as SVGElement | null;
      if (!eyeL || !eyeR) {
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
      const maxPupilOffset = 3; // Max movement in SVG units (smaller for 520x420 viewBox)
      const distance = Math.sqrt(relativeX ** 2 + relativeY ** 2);
      const maxDistance = Math.min(rect.width, rect.height) * 0.6;
      
      if (distance > 0 && maxDistance > 0) {
        const normalizedDistance = Math.min(distance / maxDistance, 1);
        const eyeOffsetX = (relativeX / distance) * maxPupilOffset * normalizedDistance;
        const eyeOffsetY = (relativeY / distance) * maxPupilOffset * normalizedDistance;
        const scaleX = 520 / rect.width;
        const scaleY = 420 / rect.height;
        gsap.to([eyeL, eyeR], {
          x: eyeOffsetX * scaleX,
          y: eyeOffsetY * scaleY,
          duration: 0.12,
          ease: "power2.out",
          overwrite: "auto"
        });
      } else {
        gsap.to([eyeL, eyeR], { x: 0, y: 0, duration: 0.12, ease: "power2.out", overwrite: "auto" });
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
      if (isMouseButtonPressed && cachedWindowPos && cachedWindowSize) {
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
      
      if (!isMouseButtonPressed && wasPressed) {
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
    
    // 不在这里初始化或重置眼睛位置
    // 让 GSAP 状态动画中的 resetToNeutral 来控制眼睛位置

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

      // 不在清理时重置眼睛位置，让状态动画来控制
    };
  }, [petState]);


  useEffect(() => {
    const appWindow = getCurrentWindow();

    const unlistenDropEvent = appWindow.onDragDropEvent((event) => {
      console.log("Tauri dragdrop event:", event.payload.type, "paths:", event.payload.paths);

      // 处理拖拽进入事件
      if (event.payload.type === "hover" || event.payload.type === "enter") {
        console.log("Tauri dragenter detected, setting waiting_for_drop");
        setPetState((currentState) => {
          if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
            return "waiting_for_drop";
          }
          return currentState;
        });
        return;
      }

      // 处理拖拽离开事件
      if (event.payload.type === "leave" || event.payload.type === "cancelled") {
        console.log("Tauri dragleave detected");
        setPetState((currentState) => {
          if (currentState === "waiting_for_drop") {
            return "idle_breathe";
          }
          return currentState;
        });
        return;
      }

      if (event.payload.type === "drop") {
        const paths = event.payload.paths;

        // Only handle file drops here - text drops are handled by DOM onDrop
        if (!paths || paths.length === 0) {
          console.log("Tauri drop with no paths - letting DOM handler take over for text");
          return;
        }

        // 清除之前的 timeout（如果有）
        if (eatChompTimeoutRef.current) {
          window.clearTimeout(eatChompTimeoutRef.current);
          eatChompTimeoutRef.current = null;
        }
        // 立即设置 eat_chomp 状态，确保动画能触发
        console.log("Tauri drop detected with files, setting eat_chomp");
        setPetState((currentState) => {
          // 如果当前是 waiting_for_drop，转换为 eat_chomp
          if (currentState === "waiting_for_drop" || currentState === "idle_breathe") {
            return "eat_chomp";
          }
          return currentState;
        });
        // 记录 drop 开始时间
        const dropStartTime = Date.now();

        // 保存待记录的路径，显示记录面板
        recordPanel.setPendingPaths(paths);
        recordPanel.setPendingText(""); // Clear any pending text
        recordPanel.setNote("");
        recordPanel.setRemindEnabled(false);
        recordPanel.setRemindAt(null);

        // Close other panels
        setPanelVisible(false);
        setChatDialogVisible(false);
        setSettingsVisible(false);
        papaSpace.setVisible(false);
        reminder.hide();
        setChatInput("");
        setChatMessages([]);

        // 确保 eat_chomp 状态持续至少 1000ms（动画时长），然后显示记录面板
        const elapsed = Date.now() - dropStartTime;
        const remaining = Math.max(1000 - elapsed, 200);
        eatChompTimeoutRef.current = window.setTimeout(() => {
          setPetState("idle_breathe");
          recordPanel.setVisible(true);
          // Focus note input
          setTimeout(() => {
            recordPanel.noteRef.current?.focus();
          }, 100);
          eatChompTimeoutRef.current = null;
        }, Math.max(remaining, 1000));
      }
    });

    return () => {
      void unlistenDropEvent.then((f) => f());
    };
  }, []);

  useEffect(() => {
    console.log("Setting up drag event listeners");

    function handleDomDrag(event: DragEvent) {
      const name = event.type;
      console.log("Drag event triggered:", name);

      if (name === "dragenter") {
        event.preventDefault();
        console.log("Drag enter detected, setting waiting_for_drop");
        setPetState((currentState) => {
          if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
            return "waiting_for_drop";
          }
          return currentState;
        });
      }
      if (name === "dragover") {
        event.preventDefault();
        setPetState((currentState) => {
          if (currentState === "idle_breathe" || currentState === "idle_blink") {
            return "waiting_for_drop";
          }
          return currentState;
        });
      }
      if (name === "dragleave") {
        setPetState((currentState) => {
          if (currentState === "waiting_for_drop") {
            return "idle_breathe";
          }
          return currentState;
        });
      }
      if (name === "drop") {
        event.preventDefault();
        setPetState((currentState) => {
          if (currentState !== "eat_chomp") {
            return "eat_chomp";
          }
          return currentState;
        });
        window.setTimeout(() => setPetState("idle_breathe"), 1000);
      }
    }

    document.addEventListener("dragenter", handleDomDrag, true);
    document.addEventListener("dragover", handleDomDrag, true);
    document.addEventListener("dragleave", handleDomDrag, true);
    document.addEventListener("drop", handleDomDrag, true);

    window.addEventListener("dragenter", handleDomDrag, true);
    window.addEventListener("dragover", handleDomDrag, true);
    window.addEventListener("dragleave", handleDomDrag, true);
    window.addEventListener("drop", handleDomDrag, true);

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
  }, []);

  useEffect(() => {
    const unlistenResize = appWindow.onResized(async () => {
      try {
        const size = await appWindow.innerSize();
        setCurrentWindowSize({ width: size.width, height: size.height });
      } catch (error) {
        console.error("Failed to get window size:", error);
      }
    });

    return () => {
      void unlistenResize.then((f) => f());
    };
  }, [appWindow]);

  // 监听 eat_chomp 状态，触发吃动画
  useEffect(() => {
    if (petState === "eat_chomp") {
      gsapStateRef.current?.playEat();
    }
  }, [petState]);

  useEffect(() => {
    const gsapState = gsapStateRef.current;
    if (!gsapState) return;

    const mapState = (state: PetState): string => {
      switch (state) {
        case "idle_breathe":
        case "idle_blink":
        case "idle":
          return "idle";
        case "thinking":
        case "think":
          return "think";
        case "success_happy":
          return "success_happy";
        case "error_confused":
          return "error_confused";
        case "waiting_for_drop":
        case "drool":
          return "drool";
        case "comfy":
        case "shy":
        case "excited":
        case "tired":
        case "surprised":
        case "sleepy":
        case "chew":
          return state;
        default:
          return "idle";
      }
    };

    if (petState === "eat_chomp" || petState === "eat_action") {
      gsapState.playEat();
      return;
    }
    gsapState.setState(mapState(petState));
  }, [petState]);

  // 监听 waiting_for_drop 状态，触发等待动画
  useEffect(() => {
    console.log("petState changed to:", petState);
    if (petState === "waiting_for_drop") {
      console.log("Triggering waiting animation");
      gsapStateRef.current?.setState("drool");
    } else if (petState !== "waiting_for_drop" && mouthLayerRef.current) {
      // 当离开等待状态时，恢复线条并隐藏椭圆，恢复40px尺寸
      const mouth = mouthLayerRef.current;
      gsap.set(mouth, { clearProps: "transform" });
    }
  }, [petState]);

  // Listen to behavior analysis and infer user mood
  useEffect(() => {
    const unlisten = listen<BehaviorAnalysis>("behavior-analysis", (event) => {
      const analysis = event.payload;
      setBehaviorAnalysis(analysis);

      // Infer user mood based on behavior
      let mood: UserMood = null;
      
      // Focused: High typing speed, low backspace ratio, moderate activity
      if (analysis.typingSpeed > 3.0 && 
          analysis.backspaceCount / Math.max(analysis.keyPressCount, 1) < 0.15 &&
          analysis.activityLevel > 0.4 && analysis.activityLevel < 0.8) {
        mood = "focused";
      }
      // Tired: Low activity, high idle time, slow typing
      else if (analysis.idleTime > 5.0 || 
               (analysis.typingSpeed < 1.0 && analysis.activityLevel < 0.2)) {
        mood = "tired";
      }
      // Excited: High mouse speed, high click rate, high activity
      else if (analysis.mouseMoveSpeed > 500.0 || 
               analysis.mouseClickCount > 10 ||
               analysis.activityLevel > 0.8) {
        mood = "excited";
      }
      // Confused: High backspace ratio, irregular activity
      else if (analysis.backspaceCount / Math.max(analysis.keyPressCount, 1) > 0.3) {
        mood = "confused";
      }
      // Relaxed: Low activity, low typing, but not idle
      else if (analysis.activityLevel < 0.3 && analysis.idleTime < 3.0) {
        mood = "relaxed";
      }

      if (mood !== userMood) {
        setUserMood(mood);
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [userMood]);

  // Listen to reminder-due events (Phase 3)
  useEffect(() => {
    const unlisten = listen<ReminderDuePayload>("reminder-due", (event) => {
      const payload = event.payload;
      console.log("Reminder due:", payload);

      // Close other panels first
      setPanelVisible(false);
      setChatDialogVisible(false);
      setSettingsVisible(false);
      recordPanel.setVisible(false);
      papaSpace.setVisible(false);

      // Show reminder panel
      reminder.show(payload);

      // Trigger excited animation
      setPetState("excited");
      gsapStateRef.current?.setState("excited");
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Trigger proactive conversation based on mood
  useEffect(() => {
    if (!userMood || panelVisible) return;
    
    const now = Date.now();
    if (now - lastConversationTime < CONVERSATION_COOLDOWN) return;

    // Only trigger conversation when mood changes or after a delay
    const triggerConversation = async () => {
      if (now - lastConversationTime < CONVERSATION_COOLDOWN) return;
      
      setLastConversationTime(now);
      
      // Build prompt based on mood and behavior
      const moodDescription = {
        focused: "The user is focused on work, with stable typing speed and low error rate",
        tired: "The user looks tired, with low activity level, may need rest",
        excited: "The user is very active, with fast mouse movement and frequent clicks",
        confused: "The user seems hesitant, with frequent use of the backspace key",
        relaxed: "The user is in a relaxed state, with low activity but not completely still"
      }[userMood];

      if (!behaviorAnalysis) return;
      
      const prompt = `You are a cute desktop pet named Papa. Based on the following user state, generate a short, warm, and natural conversation (no more than 20 words, in English):

User state: ${moodDescription}
Activity level: ${behaviorAnalysis.activityLevel.toFixed(2)}
Typing speed: ${behaviorAnalysis.typingSpeed.toFixed(1)} keys/sec

Please use first person, with a natural, warm, and cute tone, not too formal.`;

      // Check if API key is configured
      if (!llmSettings.apiKey) {
        // Don't show conversation bubble if API key is not configured
        // User should configure it first
        return;
      }

      try {
        const response = await invoke<string>("call_llm_api", {
          request: {
            provider: llmSettings.provider,
            apiKey: llmSettings.apiKey,
            model: llmSettings.model,
            prompt: prompt,
            maxTokens: 50
          }
        });

        if (response) {
          setConversationBubble({
            id: Date.now(),
            text: response.trim(),
            visible: true
          });

          // Hide bubble after 5 seconds
          setTimeout(() => {
            setConversationBubble(prev => prev ? { ...prev, visible: false } : null);
          }, 5000);
        }
      } catch (error) {
        console.error("Failed to generate conversation:", error);
        // Don't show fallback message, just log the error
      }
    };

    // Trigger conversation after mood is stable for 5 seconds
    const timer = setTimeout(triggerConversation, 5000);
    return () => clearTimeout(timer);
  }, [userMood, panelVisible, lastConversationTime, behaviorAnalysis, llmSettings]);

  // State rotation system - rotate between various idle states
  const stateRotationRef = useRef<number | null>(null);
  const lastActivityTimeRef = useRef<number>(Date.now());
  const currentPetStateRef = useRef<PetState>(petState);

  // Keep ref in sync with state
  useEffect(() => {
    currentPetStateRef.current = petState;
  }, [petState]);

  // Update activity time based on behavior analysis
  useEffect(() => {
    if (behaviorAnalysis && behaviorAnalysis.activityLevel > 0.2) {
      lastActivityTimeRef.current = Date.now();
    }
  }, [behaviorAnalysis]);

  useEffect(() => {
    // Define idle states for rotation
    const normalIdleStates: PetState[] = ["idle_breathe", "shy"];
    const tiredIdleStates: PetState[] = ["tired", "comfy", "sleepy"];
    const excitedStates: PetState[] = ["surprised", "excited"];

    function getRandomState(states: PetState[]): PetState {
      return states[Math.floor(Math.random() * states.length)];
    }

    function scheduleStateChange() {
      // Random interval: 8-20 seconds for state changes
      const interval = 8000 + Math.random() * 12000;

      stateRotationRef.current = window.setTimeout(() => {
        const currentState = currentPetStateRef.current;

        // Only change state if in an idle-like state (not eating, thinking, etc.)
        const activeStates: PetState[] = [
          "eat_chomp", "thinking", "waiting_for_drop",
          "success_happy", "error_confused", "chew", "eat_action"
        ];

        if (activeStates.includes(currentState)) {
          scheduleStateChange();
          return;
        }

        // Check if any panel is open (use current values via closure)
        // We'll check this via a simple approach - if state is not idle-like, skip

        const timeSinceActivity = Date.now() - lastActivityTimeRef.current;
        const isLongIdle = timeSinceActivity > 60000; // 1 minute without activity

        let newState: PetState;
        const random = Math.random();

        if (isLongIdle) {
          // Long idle: mostly tired/comfy states
          if (random < 0.7) {
            newState = getRandomState(tiredIdleStates);
          } else if (random < 0.9) {
            newState = getRandomState(normalIdleStates);
          } else {
            // Rare surprise even when idle
            newState = "surprised";
          }
        } else {
          // Normal activity: mostly idle/shy, occasionally excited
          if (random < 0.6) {
            newState = getRandomState(normalIdleStates);
          } else if (random < 0.85) {
            // Sometimes show comfy even with activity
            newState = getRandomState(["comfy", "shy"]);
          } else if (random < 0.95) {
            // Occasionally excited/surprised
            newState = getRandomState(excitedStates);
          } else {
            // Rare drool
            newState = "drool";
          }
        }

        // Don't set the same state twice in a row (unless it's idle_breathe)
        if (newState !== currentState || newState === "idle_breathe") {
          setPetState(newState);
          gsapStateRef.current?.setState(newState);

          // For some states, return to idle after a short duration
          const temporaryStates: PetState[] = ["surprised", "excited", "drool"];
          if (temporaryStates.includes(newState)) {
            window.setTimeout(() => {
              setPetState("idle_breathe");
              gsapStateRef.current?.setState("idle_breathe");
            }, 2000 + Math.random() * 2000);
          }
        }

        scheduleStateChange();
      }, interval);
    }

    scheduleStateChange();

    return () => {
      if (stateRotationRef.current) {
        window.clearTimeout(stateRotationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!panelVisible) return;

    // Auto-close file panel after 5 seconds
    const timer = window.setTimeout(() => {
      setPanelVisible(false);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [panelVisible]);

  useOutsideClick(panelRef, () => {
    if (panelVisible) {
      if (Date.now() < panelLockUntil) return;
      setPanelVisible(false);
    }
  });

  useEffect(() => {
    // Determine target window size based on which panel is visible
    // Priority: papaSpace > filePanel/chat/record > settings/reminder > collapsed
    let next;
    if (papaSpace.visible) {
      next = WINDOW_SIZES.papaSpace;
    } else if (panelVisible) {
      next = WINDOW_SIZES.filePanel;
    } else if (chatDialogVisible) {
      next = WINDOW_SIZES.chat;
    } else if (recordPanel.visible) {
      next = WINDOW_SIZES.record;
    } else if (settingsVisible) {
      next = WINDOW_SIZES.settings;
    } else if (reminder.toastVisible) {
      next = WINDOW_SIZES.reminder;
    } else {
      next = WINDOW_SIZES.collapsed;
    }

    // Only resize if size actually changed
    if (currentWindowSize.width === next.width && currentWindowSize.height === next.height) {
      return;
    }

    // Update CSS variable immediately for smooth visual transition
    const root = document.documentElement;
    root.style.setProperty("--window-width", `${next.width}px`);
    root.style.setProperty("--window-height", `${next.height}px`);

    // Use CSS transition for visual smoothness, only call Rust at start and end
    // Immediate resize to target for instant response, then smooth transition
    void invoke("set_window_size", { width: next.width, height: next.height }).catch((error) => {
      console.error("Failed to set window size:", error);
    });

    setCurrentWindowSize(next);
  }, [panelVisible, settingsVisible, chatDialogVisible, recordPanel.visible, papaSpace.visible, reminder.toastVisible, currentWindowSize]);


  // Update CSS variables on window resize
  useEffect(() => {
    const updateWindowSize = () => {
      const root = document.documentElement;
      root.style.setProperty("--window-width", `${currentWindowSize.width}px`);
      root.style.setProperty("--window-height", `${currentWindowSize.height}px`);
    };
    updateWindowSize();
  }, [currentWindowSize]);

  useEffect(() => {
    if (!bodyLayerRef.current) return;
    const svg = bodyLayerRef.current.querySelector("svg");
    if (!svg) return;
    const q = gsap.utils.selector(svg);
    const eyeBlinkTargets = q("#eyeL, #eyeR");
    const browTargets = q("#browL, #browR");
    const tearTargets = q("#tearL, #tearR");
    const dotTargets = q("#dot1, #dot2, #dot3");
    gsap.registerPlugin(MorphSVGPlugin);

    const shapes = {
      bunRest: "M130 318 C130 205 190 130 260 130 C330 130 390 205 390 318 Q390 335 372 340 C330 350 190 350 148 340 Q130 335 130 318 Z",
      bunOpen: "M122 318 C122 220 188 150 260 152 C332 150 398 220 398 318 Q398 340 376 346 C330 360 190 360 144 346 Q122 340 122 318 Z",
      bunBulge: "M130 318 C125 200 190 130 260 130 C330 130 395 200 390 318 Q390 350 372 366 C330 392 190 392 148 366 Q130 350 130 318 Z",
      mouthSmile: "M220 275 Q260 295 300 275 Q260 286 220 275 Z",
      mouthOpen: "M200 270 C200 240 230 220 260 220 C290 220 320 240 320 270 C320 305 295 325 260 325 C225 325 200 305 200 270 Z",
      mouthO: "M238 278 C238 260 248 248 260 248 C272 248 282 260 282 278 C282 296 272 308 260 308 C248 308 238 296 238 278 Z",
      mouthSleep: "M230 285 Q260 300 290 285 Q260 290 230 285 Z",
      mouthAngry: "M230 292 Q260 268 290 292 Q260 286 230 292 Z",
      mouthThink: "M236 286 Q260 292 284 286 Q260 288 236 286 Z",
      mouthCry: "M232 296 Q260 270 288 296 Q260 292 232 296 Z",
      mouthFlat: "M238 288 Q260 288 282 288 Q260 288 238 288 Z",
      foodSquish: "M260 108 C290 108 308 114 308 122 C308 130 290 136 260 136 C230 136 212 130 212 122 C212 114 230 108 260 108 Z"
    };

    let stateTL: gsap.core.Timeline | null = null;
    let idleTL: gsap.core.Timeline | null = null;
    let blinkTL: gsap.core.Timeline | null = null;
    let actionTL: gsap.core.Timeline | null = null;
    const killTL = (tl: gsap.core.Timeline | null) => {
      if (tl) tl.kill();
      return null;
    };

    const resetToNeutral = () => {
      stateTL = killTL(stateTL);
      actionTL = killTL(actionTL);

      gsap.set(q("#bun"), { morphSVG: { shape: shapes.bunRest, shapeIndex: "auto" } });
      gsap.set(q("#bunWrap"), { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 });
      gsap.set(q("#face"), { x: 0, y: 0, rotation: 0 });
      isBlinkingRef.current = false;
      gsap.set(q("#brows"), { opacity: 0 });
      gsap.set(browTargets, { rotation: 0, y: 0, transformOrigin: "50% 50%" });

      // 眼睛：默认圆眼显示，其他隐藏（与 gsap_example.html 一致）
      gsap.set(q("#eyesCircle"), { opacity: 1 });
      gsap.set(q("#eyesCry"), { opacity: 0 });
      gsap.set(q("#eyesStar"), { opacity: 0 });
      gsap.set(eyeBlinkTargets, { scaleY: 1, y: 0, x: 0 });

      gsap.set(q("#mouth"), {
        morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" },
        fill: "none",
        stroke: "#584030",
        strokeWidth: 10
      });

      gsap.set(q("#blush"), { opacity: 0, scale: 1, transformOrigin: "50% 50%" });
      gsap.set(q("#drool"), { opacity: 0, scaleY: 0.2, y: 0, transformOrigin: "50% 0%" });
      gsap.set(q("#tears"), { opacity: 0 });
      gsap.set(tearTargets, { y: 0, opacity: 0.85 });

      gsap.set(q("#thought"), { opacity: 0, y: 0 });
      gsap.set(dotTargets, { scale: 1, y: 0, opacity: 0.95 });

      gsap.set(q("#bolus"), { attr: { rx: 0, ry: 0, cy: 285 }, opacity: 0 });
      gsap.set(q("#food"), { x: 0, y: 0, scale: 1, opacity: 0, transformOrigin: "50% 50%" });
    };

    const startIdleLoops = () => {
      idleTL = killTL(idleTL);
      idleTL = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } })
        .to(q("#bunWrap"), { scaleX: 1.02, scaleY: 0.98, duration: 1.2 }, 0)
        .to(q("#bunWrap"), { scaleX: 1.0, scaleY: 1.0, duration: 1.2 }, 1.2)
        .to(q("#face"), { y: 1.5, duration: 1.2 }, 0)
        .to(q("#face"), { y: 0, duration: 1.2 }, 1.2);

      blinkTL = killTL(blinkTL);
      // 与 gsap_example.html 一致的眨眼动画
      const randomBlink = () => {
        const d = gsap.utils.random(1.6, 3.6);
        isBlinkingRef.current = true;
        blinkTL = gsap.timeline({
          repeat: 1,
          repeatDelay: d,
          onComplete: () => {
            isBlinkingRef.current = false;
            randomBlink();
          }
        })
          .to(eyeBlinkTargets, { scaleY: 0.1, duration: 0.06, ease: "power1.in" })
          .to(eyeBlinkTargets, { scaleY: 1.0, duration: 0.10, ease: "power1.out" });
      };
      randomBlink();
    };

    const playEat = () => {
      idleTL = killTL(idleTL);
      blinkTL = killTL(blinkTL);
      resetToNeutral();
      actionTL = gsap.timeline({ defaults: { ease: "power2.inOut" } });
      actionTL
        .to(q("#bunWrap"), { scaleX: 1.03, scaleY: 0.97, duration: 0.1 }, 0)
        .to(q("#bun"), { morphSVG: { shape: shapes.bunOpen, shapeIndex: "auto" }, duration: 0.16 }, 0.02)
        .to(q("#face"), { y: 8, duration: 0.16 }, 0.02)
        .to(q("#mouth"), {
          morphSVG: { shape: shapes.mouthOpen, shapeIndex: "auto" },
          fill: "url(#mouthGrad)",
          strokeWidth: 0,
          duration: 0.16,
          ease: "power2.out"
        }, 0.04)
        .to(q("#food"), { opacity: 1, y: 145, duration: 0.22, ease: "power2.in" }, 0.06)
        .to(q("#food"), { morphSVG: { shape: shapes.foodSquish, shapeIndex: "auto" }, duration: 0.1, ease: "power1.in" }, 0.22)
        .to(q("#food"), { scale: 0.15, opacity: 0, duration: 0.1, ease: "power1.in" }, 0.26)
        .to(q("#mouth"), {
          morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" },
          fill: "none",
          strokeWidth: 10,
          duration: 0.14
        }, 0.3)
        .to(q("#bun"), { morphSVG: { shape: shapes.bunBulge, shapeIndex: "auto" }, duration: 0.2 }, 0.3)
        .to(q("#bolus"), { opacity: 0.55, attr: { rx: 18, ry: 12, cy: 292 }, duration: 0.1, ease: "power1.out" }, 0.32)
        .to(q("#bolus"), { attr: { cy: 315, rx: 16, ry: 11 }, duration: 0.18 }, 0.42)
        .to(q("#bolus"), { attr: { cy: 342, rx: 12, ry: 9 }, opacity: 0.18, duration: 0.22 }, 0.6)
        .to(q("#bolus"), { attr: { rx: 0, ry: 0 }, opacity: 0, duration: 0.12 }, 0.8)
        .to(q("#bunWrap"), { scaleX: 1, scaleY: 1, duration: 0.28, ease: "elastic.out(1,0.55)" }, 0.78)
        .to(q("#bun"), { morphSVG: { shape: shapes.bunRest, shapeIndex: "auto" }, duration: 0.32, ease: "elastic.out(1,0.55)" }, 0.78)
        .to(q("#face"), { y: 0, duration: 0.22, ease: "power2.out" }, 0.78);
    };

    const setState = (state: string) => {
      resetToNeutral();
      if (state === "idle") {
        startIdleLoops();
        return;
      }

      stateTL = killTL(stateTL);
      if (idleTL) idleTL.kill();
      if (blinkTL) blinkTL.kill();

      switch (state) {
        case "think": {
          gsap.set(q("#brows"), { opacity: 1 });
          stateTL = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } });
          stateTL
            .to(q("#face"), { rotation: -1.5, y: 1.2, duration: 0.5 }, 0)
            .to(q("#face"), { rotation: 1.0, y: 0.2, duration: 0.6 }, 0.5)
            .to(q("#face"), { rotation: -1.5, y: 1.2, duration: 0.6 }, 1.1);
          stateTL
            .to(eyeBlinkTargets, { x: 5, y: -1, duration: 0.35 }, 0)
            .to(eyeBlinkTargets, { x: 2, y: 0, duration: 0.55 }, 0.35)
            .to(eyeBlinkTargets, { x: 5, y: -1, duration: 0.55 }, 0.9);
          stateTL
            .to(q("#browL"), { y: -6, rotation: -10, duration: 0.45 }, 0)
            .to(q("#browL"), { y: -3, rotation: -6, duration: 0.55 }, 0.45)
            .to(q("#browL"), { y: -6, rotation: -10, duration: 0.55 }, 1.0);
          stateTL.to(q("#mouth"), { morphSVG: { shape: shapes.mouthThink, shapeIndex: "auto" }, duration: 0.18 }, 0);
          stateTL.to(q("#thought"), { opacity: 1, duration: 0.18 }, 0);
          stateTL
            .to(q("#dot1"), { y: -5, scale: 1.1, duration: 0.25 }, 0.15)
            .to(q("#dot1"), { y: 0, scale: 1.0, duration: 0.35 }, 0.4)
            .to(q("#dot2"), { y: -6, scale: 1.12, duration: 0.25 }, 0.35)
            .to(q("#dot2"), { y: 0, scale: 1.0, duration: 0.35 }, 0.6)
            .to(q("#dot3"), { y: -5, scale: 1.1, duration: 0.25 }, 0.55)
            .to(q("#dot3"), { y: 0, scale: 1.0, duration: 0.35 }, 0.8);
          break;
        }
        case "comfy": {
          // 舒服：眯眼 + 缓慢摇摆
          // 直接在眼睛上设置 scaleY（与 gsap_example.html 保持一致）
          gsap.set(eyeBlinkTargets, { scaleY: 0.2, x: 0, y: 0 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" } });
          gsap.set(q("#face"), { y: 1 });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#bunWrap"), { scaleX: 1.015, scaleY: 0.985, duration: 1.4 }, 0)
            .to(q("#face"), { y: 2, duration: 1.4 }, 0)
            .to(q("#face"), { rotation: -1.0, duration: 1.4 }, 0)
            .to(q("#bunWrap"), { scaleX: 1.0, scaleY: 1.0, duration: 1.4 }, 1.4)
            .to(q("#face"), { y: 1.0, duration: 1.4 }, 1.4)
            .to(q("#face"), { rotation: 1.0, duration: 1.4 }, 1.4);
          break;
        }
        case "shy": {
          // 害羞：脸红 + 眼睛左右躲 + 轻轻歪头
          // 与 gsap_example.html 保持一致：直接操作 eyeBlinkTargets
          gsap.set(q("#blush"), { opacity: 0.8, scale: 0.95 });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
          // 脸红轻轻呼吸
          stateTL.to(q("#blush"), { opacity: 0.95, scale: 1.05, duration: 0.8 }, 0);
          // 眼睛左右躲（小幅）
          stateTL
            .to(eyeBlinkTargets, { x: 7, y: 0, duration: 0.45 }, 0)
            .to(eyeBlinkTargets, { x: -6, y: 0, duration: 0.55 }, 0.45);
          // 轻轻歪头
          stateTL
            .to(q("#face"), { rotation: -2.2, y: 1.5, duration: 0.8 }, 0)
            .to(q("#face"), { rotation: 1.4, y: 0.5, duration: 0.8 }, 0.8);
          stateTL.to(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" }, duration: 0.2 }, 0);
          break;
        }
        case "drool": {
          // 流口水：嘴角液滴循环 + 眯眼（更"馋"）
          // 与 gsap_example.html 保持一致
          gsap.set(q("#drool"), { opacity: 0.9, scaleY: 0.2, y: 0 });
          stateTL = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } });
          // 轻微咀嚼感（很克制）
          stateTL.to(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" }, duration: 0.2 }, 0);
          // 液滴长出来 -> 下坠 -> 回缩
          stateTL
            .to(q("#drool"), { scaleY: 1.15, duration: 0.55, ease: "power1.out" }, 0.05)
            .to(q("#drool"), { y: 8, opacity: 0.65, duration: 0.55, ease: "power2.in" }, 0.05)
            .to(q("#drool"), { scaleY: 0.2, y: 0, opacity: 0.9, duration: 0.25, ease: "power1.out" }, 0.68);
          // 眯一点眼（直接操作 eyeBlinkTargets）
          stateTL
            .to(eyeBlinkTargets, { scaleY: 0.35, duration: 0.35 }, 0.05)
            .to(eyeBlinkTargets, { scaleY: 0.55, duration: 0.55 }, 0.40);
          break;
        }
        case "excited": {
          // 兴奋跳跳：星星眼 + squash & stretch 跳跃 + 星星微闪
          // 与 gsap_example.html 保持一致
          gsap.set(q("#eyesCircle"), { opacity: 0 });
          gsap.set(q("#eyesStar"), { opacity: 1 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } });
          // 经典 squash & stretch 跳跃
          stateTL
            .to(q("#bunWrap"), { y: 0, scaleX: 1.08, scaleY: 0.92, duration: 0.12, ease: "power2.in" }, 0)
            .to(q("#bunWrap"), { y: -22, scaleX: 0.96, scaleY: 1.05, duration: 0.20, ease: "power2.out" }, 0.12)
            .to(q("#bunWrap"), { y: 0, scaleX: 1.06, scaleY: 0.94, duration: 0.14, ease: "power2.in" }, 0.32)
            .to(q("#bunWrap"), { y: -14, scaleX: 0.98, scaleY: 1.03, duration: 0.18, ease: "power2.out" }, 0.46)
            .to(q("#bunWrap"), { y: 0, scaleX: 1.00, scaleY: 1.00, duration: 0.18, ease: "elastic.out(1,0.6)" }, 0.64);
          // 星星微闪
          stateTL
            .to(q("#starL, #starR"), { scale: 1.06, duration: 0.25 }, 0.10)
            .to(q("#starL, #starR"), { scale: 0.96, duration: 0.35 }, 0.35);
          break;
        }
        case "tired": {
          // 疲惫：半眯眼 + 眼睛下垂 + 身体下沉
          // 与 gsap_example.html 保持一致：直接在 eyeBlinkTargets 上设置 scaleY 和 y
          gsap.set(eyeBlinkTargets, { scaleY: 0.25, y: 3 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthFlat, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#bunWrap"), { y: 6, scaleX: 1.015, scaleY: 0.985, duration: 1.2 }, 0)
            .to(q("#face"), { y: 3.5, rotation: -1.2, duration: 1.2 }, 0)
            .to(q("#bunWrap"), { y: 2, scaleX: 1.0, scaleY: 1.0, duration: 1.2 }, 1.2)
            .to(q("#face"), { y: 2.0, rotation: 1.0, duration: 1.2 }, 1.2);
          break;
        }
        case "surprised": {
          // 惊讶：O型嘴 + 眉毛上扬 + 身体轻微后仰
          gsap.set(q("#brows"), { opacity: 1 });
          stateTL = gsap.timeline({ defaults: { ease: "power2.out" } })
            .to(q("#mouth"), {
              morphSVG: { shape: shapes.mouthO, shapeIndex: "auto" },
              fill: "url(#mouthGrad)",
              strokeWidth: 0,
              duration: 0.14
            }, 0)
            .to(q("#browL"), { y: -8, duration: 0.16 }, 0)
            .to(q("#browR"), { y: -8, duration: 0.16 }, 0)
            .to(q("#bunWrap"), { scaleX: 0.98, scaleY: 1.02, duration: 0.16 }, 0)
            .to(q("#bunWrap"), { scaleX: 1.00, scaleY: 1.00, duration: 0.28, ease: "elastic.out(1,0.55)" }, 0.16);
          break;
        }
        case "sleepy": {
          // 困：眯眼 + 脸下垂 + 缓慢呼吸循环
          gsap.set(eyeBlinkTargets, { scaleY: 0.18 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthSleep, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#face"), { y: 5, duration: 1.2 }, 0)
            .to(q("#bunWrap"), { scaleX: 1.01, scaleY: 0.99, duration: 1.2 }, 0);
          break;
        }
        case "chew": {
          // 咀嚼：嘴巴开合 + 脸上下动 + 身体轻微起伏
          stateTL = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } })
            .to(q("#face"), { y: 2, duration: 0.12 }, 0)
            .to(q("#mouth"), { morphSVG: { shape: shapes.mouthSleep, shapeIndex: "auto" }, duration: 0.12 }, 0)
            .to(q("#face"), { y: 0, duration: 0.12 }, 0.12)
            .to(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" }, duration: 0.12 }, 0.12)
            .to(q("#bunWrap"), { scaleX: 1.015, scaleY: 0.985, duration: 0.24 }, 0)
            .to(q("#bunWrap"), { scaleX: 1.0, scaleY: 1.0, duration: 0.24 }, 0.24);
          break;
        }
        default:
          break;
      }
    };

    // 完全按照 gsap_example.html 的设置
    gsap.set(q("#bunWrap"), { transformOrigin: "50% 80%", svgOrigin: "260 320" });
    gsap.set(eyeBlinkTargets, { transformOrigin: "50% 50%" });
    gsap.set(q("#mouth"), { transformOrigin: "50% 50%" });
    gsap.set(q("#face"), { transformOrigin: "50% 50%" });
    gsap.set(q("#drool"), { transformOrigin: "50% 0%" });
    gsap.set(tearTargets, { transformOrigin: "50% 0%" });

    gsapStateRef.current = { resetToNeutral, startIdleLoops, setState, playEat };
    setState("idle");
    startIdleLoops();

    return () => {
      killTL(stateTL);
      killTL(idleTL);
      killTL(blinkTL);
      killTL(actionTL);
      gsapStateRef.current = null;
    };
  }, []);

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
    gsapStateRef.current?.playEat();
  }

  function triggerWaitingAnimation() {
    gsapStateRef.current?.setState("drool");
  }

  // Handle RAG chat - search database and chat with context
  const handleRagChat = async () => {
    if (!llmSettings.apiKey) {
      setPanelVisible(false);
      setChatDialogVisible(false);
      recordPanel.setVisible(false);
      papaSpace.setVisible(false);
      reminder.hide();
      setSettingsVisible(true);
      return;
    }

    const userMessage = chatInput.trim();
    if (!userMessage) return;

    // Add user message to chat
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");
    setChatLoading(true);
    setPetState("thinking");

    try {
      // Search database for relevant context
      const ragContext = await searchForRag(userMessage, 5);

      // Build context from search results
      let contextText = "";
      if (ragContext.events.length > 0) {
        contextText = "Here is some relevant information from my records:\n\n";
        for (const event of ragContext.events) {
          const date = new Date(event.created_at).toLocaleDateString();
          contextText += `[${date}] `;
          if (event.title) contextText += `${event.title}: `;
          if (event.note) contextText += event.note;
          if (event.text_content) contextText += `\nContent: ${event.text_content.slice(0, 500)}`;
          contextText += "\n\n";
        }
      }

      // Build prompt with context
      const prompt = contextText
        ? `You are Papa, a helpful assistant. Use the following context from the user's records to answer their question. If the context doesn't contain relevant information, just have a friendly conversation.

Context:
${contextText}

User's question: ${userMessage}

Please respond in a helpful and friendly manner.`
        : `You are Papa, a helpful assistant. The user has no relevant records for this query. Please have a friendly conversation.

User: ${userMessage}

Please respond in a helpful and friendly manner.`;

      const response = await invoke<string>("call_llm_api", {
        request: {
          provider: llmSettings.provider,
          apiKey: llmSettings.apiKey,
          model: llmSettings.model,
          prompt: prompt,
          maxTokens: 800
        }
      });

      setChatMessages(prev => [...prev, { role: "assistant", content: response.trim() }]);
      setPetState("success_happy");
      setTimeout(() => setPetState("idle_breathe"), 1200);

      // Scroll to bottom
      setTimeout(() => {
        chatMessagesRef.current?.scrollTo({ top: chatMessagesRef.current.scrollHeight, behavior: "smooth" });
      }, 100);
    } catch (error) {
      console.error("Failed to process chat:", error);
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Please check your API Key configuration." }]);
      setPetState("error_confused");
      setTimeout(() => setPetState("idle_breathe"), 1200);
    } finally {
      setChatLoading(false);
    }
  };

  // ============ Reminder Toast Functions (Phase 3) ============

  // Handle reminder dismiss (complete)
  const handleReminderDismiss = async () => {
    const success = await reminder.dismiss();
    if (success) {
      setPetState("success_happy");
      gsapStateRef.current?.setState("success_happy");
      setTimeout(() => {
        setPetState("idle_breathe");
      }, 1000);
    }
  };

  // Handle reminder snooze
  const handleReminderSnooze = async (minutes: number) => {
    const success = await reminder.snooze(minutes);
    if (success) {
      setPetState("comfy");
      gsapStateRef.current?.setState("comfy");
      setTimeout(() => {
        setPetState("idle_breathe");
      }, 800);
    }
  };

  // Handle reminder open (view details)
  const handleReminderOpen = () => {
    // Open Papa Space with event details
    reminder.hide();
    if (reminder.activeReminder) {
      void openPapaSpace();
      // Select the date of the reminder event
      const eventDate = formatLocalDate(new Date(reminder.activeReminder.event.createdAt));
      papaSpace.setSelectedDate(eventDate);
    }
    setPetState("idle_breathe");
  };

  // ============ Papa Space Functions (Phase 4) ============

  // Open Papa Space (uses hook but handles panel coordination)
  const openPapaSpace = async () => {
    console.log("Opening Papa Space...");
    // Close other panels
    setPanelVisible(false);
    setChatDialogVisible(false);
    setSettingsVisible(false);
    recordPanel.setVisible(false);
    reminder.hide();

    papaSpace.open();
    try {
      await papaSpace.loadEvents(papaSpace.selectedDate);
    } catch (error) {
      console.error("Failed to load Papa Space events:", error);
    }
  };

  // Export current day
  const handleExportDay = async (format: "md" | "html") => {
    try {
      setPetState("thinking");
      const outputPath = await generateDailyExport(
        papaSpace.selectedDate,
        format,
        exportSettings.exportPath || undefined
      );
      console.log("Export saved to:", outputPath);
      setPetState("success_happy");
      setTimeout(() => setPetState("idle_breathe"), 1000);
    } catch (error) {
      console.error("Failed to export:", error);
      setPetState("error_confused");
      setTimeout(() => setPetState("idle_breathe"), 1000);
    }
  };

  // Open exports folder
  const handleOpenExportsFolder = async () => {
    try {
      const folderPath = await openExportFolder(exportSettings.exportPath || undefined);
      console.log("Exports folder:", folderPath);
    } catch (error) {
      console.error("Failed to get exports folder:", error);
    }
  };

  // Generate AI summary for the day
  const handleGenerateAISummary = async () => {
    if (!llmSettings.apiKey) {
      // Close other panels and open settings
      papaSpace.setVisible(false);
      setSettingsVisible(true);
      return;
    }

    if (papaSpace.events.length === 0) {
      papaSpace.setAISummary("No records today. Start capturing some thoughts!");
      papaSpace.setShowSummary(true);
      return;
    }

    papaSpace.setAISummaryLoading(true);
    papaSpace.setShowSummary(true);
    papaSpace.setAISummary("");
    setPetState("thinking");

    try {
      // Build context from today's events
      const eventsContext = papaSpace.events.map((item, index) => {
        const time = new Date(item.event.createdAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit"
        });
        const typeIcon = item.event.type === "image" ? "Image" : item.event.type === "text" ? "Text" : "File";
        const title = item.event.title || "Untitled";
        const note = item.event.note || "";
        const attachments = item.attachments.map(a => a.fileName).join(", ");

        let entry = `[${time}] ${typeIcon}: ${title}`;
        if (note) entry += ` - "${note}"`;
        return entry;
      }).join("\n");

      const prompt = `You are a personal thought assistant. The user recorded these sparks of ideas today:

${eventsContext}

Provide a brief summary (max 150 words) with:
🎯 **Theme**: Main focus of the day (1 sentence)
💡 **Insight**: Key takeaway or pattern (1 sentence)
🌟 **Next**: One actionable suggestion (1 sentence)

Keep it warm and concise. If few records, just give a simple reflection.`;

      const result = await invoke<string>("call_llm_api", {
        request: {
          provider: llmSettings.provider,
          apiKey: llmSettings.apiKey,
          model: llmSettings.model,
          prompt: prompt,
          maxTokens: 300
        }
      });

      papaSpace.setAISummary(result);
      setPetState("success_happy");
      setTimeout(() => setPetState("idle_breathe"), 1500);
    } catch (error) {
      console.error("Failed to generate AI summary:", error);
      papaSpace.setAISummary("Failed to generate summary. Please try again.");
      setPetState("error_confused");
      setTimeout(() => setPetState("idle_breathe"), 1500);
    } finally {
      papaSpace.setAISummaryLoading(false);
    }
  };

  // ============ Record Panel Functions (Phase 2) ============

  // Save record to timeline
  const handleSaveRecord = async () => {
    if (recordPanel.pendingPaths.length === 0 && !recordPanel.pendingText) return;

    setPetState("thinking");

    const result = await recordPanel.save();

    if (result) {
      setPetState("success_happy");
      setTimeout(() => {
        recordPanel.close();
        setPetState("idle_breathe");
      }, 800);
    } else {
      setPetState("error_confused");
      setTimeout(() => setPetState("idle_breathe"), 1200);
    }
  };

  // Cancel record and close panel
  const handleCancelRecord = () => {
    recordPanel.close();
    setPetState("idle_breathe");
  };

  // Quick remind options (use hook method)
  const handleQuickRemind = recordPanel.setQuickRemind;

  // Format file name for display
  // Format remind time for display
  const formatRemindTime = (date: Date | null): string => {
    if (!date) return "";
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const minutes = Math.round(diff / 60000);

    if (minutes < 60) return `in ${minutes}m`;
    if (minutes < 1440) return `in ${Math.round(minutes / 60)}h`;
    return `in ${Math.round(minutes / 1440)}d`;
  };

  // Reset to initial state function (for pet click)
  const resetToInitialOnClick = () => {
    setPanelVisible(false);
    setDropRecord(null);
    setPetState("idle_breathe");
    setSettingsVisible(false);
    setConversationBubble(null);
    setChatDialogVisible(false);
    setChatInput("");
    setChatMessages([]);
    // Close record panel
    recordPanel.close();
    // Close Papa Space
    papaSpace.close();
    // Close reminder toast
    reminder.hide();

    // Clear any pending timeouts
    if (successHappyTimeoutRef.current) {
      window.clearTimeout(successHappyTimeoutRef.current);
      successHappyTimeoutRef.current = null;
    }
    if (eatChompTimeoutRef.current) {
      window.clearTimeout(eatChompTimeoutRef.current);
      eatChompTimeoutRef.current = null;
    }

    if (gsapStateRef.current) {
      gsapStateRef.current.resetToNeutral();
      gsapStateRef.current.startIdleLoops();
    }
  };

  return (
    <div
      className={`app-root state-${activeState}`}
      onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
        // Ignore right-click (button 2) - let context menu handle it
        if (event.button === 2) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-no-drag]")) return;
        if (target.closest(".pet-wrapper")) {
          // Record click start position and time for click detection
          petClickStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            time: Date.now()
          };
          event.preventDefault();
        }
      }}
      onPointerUp={(event: React.PointerEvent<HTMLDivElement>) => {
        // Ignore right-click (button 2) - let context menu handle it
        if (event.button === 2) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-no-drag]")) return;
        if (target.closest(".pet-wrapper") && petClickStartRef.current) {
          const start = petClickStartRef.current;
          const endTime = Date.now();
          const moveDistance = Math.sqrt(
            Math.pow(event.clientX - start.x, 2) + Math.pow(event.clientY - start.y, 2)
          );
          const clickDuration = endTime - start.time;
          
          // If it's a quick click (less than 300ms and moved less than 5px)
          if (clickDuration < 300 && moveDistance < 5) {
            // If chat dialog is open, close it and reset
            if (chatDialogVisible) {
              resetToInitialOnClick();
            }
            // If in initial state (no other panels open), show chat dialog
            else if (!panelVisible && !settingsVisible && !chatDialogVisible && !recordPanel.visible && !papaSpace.visible && !reminder.toastVisible && petState === "idle_breathe") {
              // Close all other panels first
              setPanelVisible(false);
              setSettingsVisible(false);
              recordPanel.setVisible(false);
              papaSpace.setVisible(false);
              reminder.hide();
              setDropRecord(null);
              setChatDialogVisible(true);
              // Focus input after dialog opens
              setTimeout(() => {
                chatInputRef.current?.focus();
              }, 100);
            } else {
              // Otherwise, reset to initial
              resetToInitialOnClick();
            }
            petClickStartRef.current = null;
            return;
          }
          
          // Otherwise, it was a drag, start window dragging
          void appWindow.startDragging();
          petClickStartRef.current = null;
        }
      }}
      onPointerMove={(event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest(".pet-wrapper") && petClickStartRef.current) {
          const start = petClickStartRef.current;
          const moveDistance = Math.sqrt(
            Math.pow(event.clientX - start.x, 2) + Math.pow(event.clientY - start.y, 2)
          );
          // If moved more than 5px, it's a drag, start window dragging
          if (moveDistance > 5) {
            void appWindow.startDragging();
            petClickStartRef.current = null;
          }
        }
      }}
      onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        // 不要阻止事件传播，让 window 监听器也能收到
        // event.stopPropagation();
      }}
      onDragEnter={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setPetState((currentState) => {
          if (currentState !== "waiting_for_drop" && currentState !== "eat_chomp") {
            return "waiting_for_drop";
          }
          return currentState;
        });
      }}
      onDragLeave={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        // 只有当真正离开窗口时才恢复（避免子元素触发）
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const x = event.clientX;
        const y = event.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
          setPetState((currentState) => {
            if (currentState === "waiting_for_drop") {
              return "idle_breathe";
            }
            return currentState;
          });
        }
      }}
      onDrop={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();

        // Debug logging (can be removed in production)
        console.log("DOM onDrop - types:", event.dataTransfer.types);

        // Clear any existing timeout
        if (eatChompTimeoutRef.current) {
          window.clearTimeout(eatChompTimeoutRef.current);
          eatChompTimeoutRef.current = null;
        }

        // Check for file drops first (files take priority over text)
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
          console.log("Files detected:", files.length);
          setPetState("eat_chomp");

          // Close other panels
          setPanelVisible(false);
          setChatDialogVisible(false);
          setSettingsVisible(false);
          papaSpace.setVisible(false);
          reminder.hide();
          setChatInput("");
          setChatMessages([]);

          // Read files and save them to get paths
          const filePromises: Promise<string>[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            filePromises.push(
              new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async () => {
                  try {
                    const arrayBuffer = reader.result as ArrayBuffer;
                    const content = Array.from(new Uint8Array(arrayBuffer));
                    const savedPath = await saveDroppedFile(file.name, content);
                    resolve(savedPath);
                  } catch (err) {
                    reject(err);
                  }
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(file);
              })
            );
          }

          // Process all files
          Promise.all(filePromises)
            .then((paths) => {
              console.log("Files saved to:", paths);
              recordPanel.setPendingPaths(paths);
              recordPanel.setPendingText("");
              recordPanel.setNote("");
              recordPanel.setRemindEnabled(false);
              recordPanel.setRemindAt(null);

              // Show record panel after eat animation
              eatChompTimeoutRef.current = window.setTimeout(() => {
                setPetState("idle_breathe");
                recordPanel.setVisible(true);
                eatChompTimeoutRef.current = null;
                setTimeout(() => {
                  recordPanel.noteRef.current?.focus();
                }, 100);
              }, 1000);
            })
            .catch((err) => {
              console.error("Failed to save files:", err);
              setPetState("error_confused");
              setTimeout(() => setPetState("idle_breathe"), 2000);
            });
          return;
        }

        // Check for text data (dragged selection)
        const text = event.dataTransfer.getData("text/plain");
        if (text && text.trim()) {
          console.log("Text dropped:", text.slice(0, 50) + "...");
          setPetState("eat_chomp");

          // Close other panels
          setPanelVisible(false);
          setChatDialogVisible(false);
          setSettingsVisible(false);
          papaSpace.setVisible(false);
          reminder.hide();

          // Set pending text for record panel
          recordPanel.setPendingText(text.trim());
          recordPanel.setPendingPaths([]);
          recordPanel.setNote("");
          recordPanel.setRemindEnabled(false);
          recordPanel.setRemindAt(null);

          // Show record panel after eat animation
          eatChompTimeoutRef.current = window.setTimeout(() => {
            setPetState("idle_breathe");
            recordPanel.setVisible(true);
            eatChompTimeoutRef.current = null;
            setTimeout(() => {
              recordPanel.noteRef.current?.focus();
            }, 100);
          }, 1000);
          return;
        }

        // No files or text detected in drop
      }}
    >
      <div
        className={`pet-stage ${panelVisible || settingsVisible || chatDialogVisible || recordPanel.visible || papaSpace.visible || reminder.toastVisible ? "panel-open" : ""} ${
          (panelVisible || settingsVisible || chatDialogVisible || recordPanel.visible || papaSpace.visible || reminder.toastVisible) && !isExpanded ? "panel-fallback" : ""
        }`}
      >
        <div className="pet-drag-hint">Drop files here</div>
        <div
          ref={petWrapperRef}
          className="pet-wrapper"
          onContextMenu={(event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenu({ x: event.clientX, y: event.clientY, visible: true });
          }}
        >
          <div className="pet-layer body" ref={bodyLayerRef}>
            <svg viewBox="0 0 520 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <defs>
                <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.22" />
                </filter>
                <clipPath id="bunClip">
                  <use href="#bun" />
                </clipPath>
                <radialGradient id="mouthGrad" cx="50%" cy="35%" r="70%">
                  <stop offset="0%" stopColor="#6b3e1f" />
                  <stop offset="60%" stopColor="#4b2a14" />
                  <stop offset="100%" stopColor="#351e10" />
                </radialGradient>
              </defs>

              <g id="bunWrap" filter="url(#shadow)">
                <path
                  id="bun"
                  fill="#f8f8e0"
                  d="M130 318 C130 205 190 130 260 130 C330 130 390 205 390 318 Q390 335 372 340 C330 350 190 350 148 340 Q130 335 130 318 Z"
                />

                <g id="thought" opacity="0">
                  <circle id="dot1" cx="236" cy="112" r="5" fill="#ffffff" opacity="0.95" />
                  <circle id="dot2" cx="260" cy="106" r="5" fill="#ffffff" opacity="0.95" />
                  <circle id="dot3" cx="284" cy="112" r="5" fill="#ffffff" opacity="0.95" />
                </g>

                <g id="face">
                  <g id="blush" opacity="0">
                    <circle id="blushL" cx="170" cy="275" r="18" fill="#ff8fa3" opacity="0.55" />
                    <circle id="blushR" cx="350" cy="275" r="18" fill="#ff8fa3" opacity="0.55" />
                  </g>

                  <g id="eyesCircle" className={`pet-layer eyes ${activeState}`} ref={eyesLayerRef}>
                    <circle id="eyeL" cx="205" cy="230" r="10" fill="#584030" />
                    <circle id="eyeR" cx="315" cy="230" r="10" fill="#584030" />
                  </g>

                  <g id="eyesCry" opacity="0">
                    <path id="cryEyeL" d="M193 232 Q205 246 217 232" fill="none" stroke="#584030" strokeWidth="8" strokeLinecap="round" />
                    <path id="cryEyeR" d="M303 232 Q315 246 327 232" fill="none" stroke="#584030" strokeWidth="8" strokeLinecap="round" />
                  </g>

                  <g id="eyesStar" opacity="0">
                    <polygon id="starL" points="205,216 210,226 221,227 213,234 216,245 205,239 194,245 197,234 189,227 200,226"
                      fill="#ffd86b" stroke="#584030" strokeWidth="3" strokeLinejoin="round" />
                    <polygon id="starR" points="315,216 320,226 331,227 323,234 326,245 315,239 304,245 307,234 299,227 310,226"
                      fill="#ffd86b" stroke="#584030" strokeWidth="3" strokeLinejoin="round" />
                  </g>

                  <g id="brows" opacity="0">
                    <path id="browL" d="M185 208 Q205 198 225 208" fill="none" stroke="#584030" strokeWidth="6" strokeLinecap="round" />
                    <path id="browR" d="M295 208 Q315 198 335 208" fill="none" stroke="#584030" strokeWidth="6" strokeLinecap="round" />
                  </g>

                  <g className={`pet-layer mouth ${activeState}`} ref={mouthLayerRef}>
                    <path id="mouth"
                      d="M220 275 Q260 295 300 275 Q260 286 220 275 Z"
                      fill="none" stroke="#584030" strokeWidth="10" strokeLinejoin="round" />

                    <path id="drool"
                      d="M304 282 C312 284 316 292 314 300 C312 308 306 312 304 316 C302 312 296 308 294 300 C292 292 296 284 304 282 Z"
                      fill="#9ad6ff" opacity="0" />

                    <g id="tears" opacity="0">
                      <path id="tearL" d="M208 246 C216 258 214 268 208 276 C202 268 200 258 208 246 Z"
                        fill="#9ad6ff" opacity="0.85" />
                      <path id="tearR" d="M318 246 C326 258 324 268 318 276 C312 268 310 258 318 246 Z"
                        fill="#9ad6ff" opacity="0.85" />
                    </g>

                    <ellipse id="bolus" cx="260" cy="285" rx="0" ry="0" fill="#e8d9b6" opacity="0" clipPath="url(#bunClip)" />
                  </g>
                </g>
              </g>

              <path id="food"
                d="M260 90 C278 92 292 104 290 122 C288 140 273 150 260 152 C247 150 232 140 230 122 C228 104 242 92 260 90 Z"
                fill="#9ad6ff" stroke="#6bbcf6" strokeWidth="4" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="pet-layer tail" ref={tailLayerRef} />
        </div>
        {conversationBubble && conversationBubble.visible && (
          <div className="conversation-bubble" data-no-drag>
            <div className="conversation-bubble-content">
              {conversationBubble.text}
            </div>
            <div className="conversation-bubble-tail" />
          </div>
        )}
        {panelVisible && dropRecord && (
          <div
            className="bubble-panel file-panel"
            ref={panelRef}
            data-no-drag
          >
            <div className="bubble-header">
              <span>📁 File received</span>
            </div>
            <div className="file-info">
              <span className="file-name">{dropRecord.path.split(/[\\/]/).pop()}</span>
              <span className="file-hint">Saved to your records</span>
            </div>
          </div>
        )}
        {chatDialogVisible && (
          <div className={`bubble-panel chat-dialog`} data-no-drag>
            <div className="bubble-header">
              <span>🔍 Ask Papa</span>
            </div>
            <div className="chat-content">
              {/* Chat messages */}
              <div className="chat-messages" ref={chatMessagesRef}>
                {chatMessages.length === 0 && (
                  <div className="chat-empty">
                    Ask me anything about your records!
                  </div>
                )}
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`chat-message chat-message-${msg.role}`}>
                    <span className="chat-message-icon">{msg.role === "user" ? "👤" : "🐱"}</span>
                    <div className="chat-message-content">{msg.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-message chat-message-assistant">
                    <span className="chat-message-icon">🐱</span>
                    <div className="chat-message-content chat-typing">Thinking...</div>
                  </div>
                )}
              </div>
              {/* Chat input */}
              <div className="chat-input-row">
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !chatLoading && chatInput.trim() && llmSettings.apiKey) {
                      e.preventDefault();
                      handleRagChat();
                    }
                  }}
                  placeholder={llmSettings.apiKey ? "Ask about your records..." : "API Key required"}
                  className="chat-input"
                  disabled={chatLoading || !llmSettings.apiKey}
                  data-no-drag
                />
                <button
                  onClick={handleRagChat}
                  disabled={chatLoading || !chatInput.trim() || !llmSettings.apiKey}
                  className="chat-send-button"
                  data-no-drag
                >
                  {chatLoading ? "..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}
        <SettingsPanel
          visible={settingsVisible}
          llmSettings={llmSettings}
          exportSettings={exportSettings}
          onProviderChange={updateLlmProvider}
          onSettingsChange={updateLlmSettings}
          onSelectExportFolder={selectExportFolder}
          onResetExportPath={resetExportPath}
        />
        <RecordPanel
          visible={recordPanel.visible}
          pendingPaths={recordPanel.pendingPaths}
          pendingText={recordPanel.pendingText}
          note={recordPanel.note}
          remindEnabled={recordPanel.remindEnabled}
          remindAt={recordPanel.remindAt}
          saving={recordPanel.saving}
          noteRef={recordPanel.noteRef}
          onNoteChange={recordPanel.setNote}
          onRemindEnabledChange={recordPanel.setRemindEnabled}
          onRemindAtChange={recordPanel.setRemindAt}
          onQuickRemind={handleQuickRemind}
          onSave={handleSaveRecord}
          onCancel={handleCancelRecord}
          formatRemindTime={formatRemindTime}
        />
        {/* Reminder Panel (Phase 3) */}
        <ReminderToast
          visible={reminder.toastVisible}
          reminder={reminder.activeReminder}
          onClose={() => {
            reminder.hide();
            setPetState("idle_breathe");
          }}
          onDismiss={handleReminderDismiss}
          onSnooze={handleReminderSnooze}
        />
        {/* Papa Space (Phase 4) */}
        <PapaSpacePanel
          visible={papaSpace.visible}
          events={papaSpace.events}
          selectedDate={papaSpace.selectedDate}
          loading={papaSpace.loading}
          aiSummary={papaSpace.aiSummary}
          aiSummaryLoading={papaSpace.aiSummaryLoading}
          showSummary={papaSpace.showSummary}
          editingEvent={papaSpace.editingEvent}
          editNote={papaSpace.editNote}
          onDateChange={papaSpace.changeDate}
          onStartEdit={papaSpace.startEdit}
          onRemoveEvent={papaSpace.removeEvent}
          onSaveEventNote={papaSpace.saveEventNote}
          onSetShowSummary={papaSpace.setShowSummary}
          onSetEditNote={papaSpace.setEditNote}
          onSetEditingEvent={papaSpace.setEditingEvent}
          onGenerateAISummary={() => void handleGenerateAISummary()}
          onExportDay={handleExportDay}
          onOpenExportsFolder={() => void handleOpenExportsFolder()}
          getRecentDates={papaSpace.getRecentDates}
          formatDateDisplay={papaSpace.formatDateDisplay}
        />
      </div>
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        visible={contextMenu.visible}
        onClose={() => setContextMenu({ ...contextMenu, visible: false })}
        onOpenPapaSpace={() => void openPapaSpace()}
        onOpenSettings={() => {
          setPanelVisible(false);
          setChatDialogVisible(false);
          recordPanel.setVisible(false);
          papaSpace.setVisible(false);
          reminder.hide();
          setSettingsVisible(true);
        }}
      />

      <div className="pet-assets" aria-hidden>
        <img src={PET_LAYER_SRC} alt="" />
      </div>
    </div>
  );
}
