import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { animate } from "animejs";
import { gsap } from "gsap";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";

const PET_LAYER_SRC = "/assets/pet-placeholder.png";

type PetState =
  | "idle_breathe"
  | "idle_blink"
  | "eat_chomp"
  | "thinking"
  | "success_happy"
  | "error_confused"
  | "waiting_for_drop"
  | "idle"
  | "think"
  | "happy"
  | "comfy"
  | "shy"
  | "cry"
  | "drool"
  | "excited"
  | "tired"
  | "angry"
  | "surprised"
  | "sleepy"
  | "chew"
  | "eat_action";

type DropRecord = {
  id: number;
  path: string;
  hash: string;
  createdAt: number;
};

type DropProcessedPayload = {
  record: DropRecord;
};

type BehaviorAnalysis = {
  typingSpeed: number;
  keyPressCount: number;
  backspaceCount: number;
  mouseMoveSpeed: number;
  mouseClickCount: number;
  idleTime: number;
  activityLevel: number;
};

type UserMood = "focused" | "tired" | "excited" | "confused" | "relaxed" | null;

type ConversationBubble = {
  id: number;
  text: string;
  visible: boolean;
};

type LlmSettings = {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
};

const BLINK_MIN_MS = 15000; /* 更频繁的眨眼，更可爱 */
const BLINK_MAX_MS = 30000;
const USE_MOCK = true;
const MOOD_CHECK_INTERVAL = 3000; // 每3秒检查一次心情
const CONVERSATION_COOLDOWN = 30000; // 对话冷却时间30秒

const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "openai",
  apiKey: "",
  model: "gpt-3.5-turbo"
};

const getPupilState = (el: Element) => ({
  x: parseFloat(el.getAttribute("data-eye-x") || "0"),
  y: parseFloat(el.getAttribute("data-eye-y") || "0"),
  scale: parseFloat(el.getAttribute("data-eye-scale") || "1")
});

const setPupilState = (el: Element, x: number, y: number, scale = 1) => {
  el.setAttribute("data-eye-x", x.toString());
  el.setAttribute("data-eye-y", y.toString());
  el.setAttribute("data-eye-scale", scale.toString());
  if (el instanceof SVGCircleElement) {
    const baseX = parseFloat(el.getAttribute("data-base-x") || el.getAttribute("cx") || "0");
    const baseY = parseFloat(el.getAttribute("data-base-y") || el.getAttribute("cy") || "0");
    const baseR = parseFloat(el.getAttribute("data-base-r") || el.getAttribute("r") || "0");
    el.setAttribute("cx", (baseX + x).toString());
    el.setAttribute("cy", (baseY + y).toString());
    el.setAttribute("r", (baseR * scale).toString());
    return;
  }
  if (el instanceof HTMLElement) {
    el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
  }
};

const getPupilOffset = (el: Element) => {
  const { x, y } = getPupilState(el);
  return { x, y };
};

const setPupilOffset = (el: Element, x: number, y: number) => {
  const { scale } = getPupilState(el);
  setPupilState(el, x, y, scale);
};

const LLM_MODELS = {
  openai: ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo"],
  anthropic: ["claude-3-haiku-20240307", "claude-3-sonnet-20240229", "claude-3-opus-20240229"]
};
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
  kind: "summarize" | "actions" | "remember",
  filePath: string,
  llmSettings: LlmSettings
): Promise<string> {
  // Require API key configuration
  if (!llmSettings.apiKey) {
    const operationName = {
      summarize: "Summarize file",
      actions: "Extract action items",
      remember: "Create memory summary"
    }[kind];
    
    return `⚠️ API Key Required\n\nTo use the "${operationName}" feature, please configure your LLM API Key first.\n\nClick the "⚙️ Settings" button in the top right corner and enter your API Key.\n\nSupported providers:\n• OpenAI (GPT-3.5, GPT-4)\n• Anthropic (Claude)`;
  }

  try {
    // Read file content
    const fileContent = await invoke<string>("read_file_content", {
      filePath: filePath
    });

    // Build prompt based on operation type
    let prompt = "";
    const fileName = filePath.split(/[\\/]/).pop() || "file";
    
    if (kind === "summarize") {
      prompt = `Please summarize the content of the following file. File name: ${fileName}

File content:
${fileContent}

Please provide a concise and accurate summary in English, highlighting the main content and key information.`;
    } else if (kind === "actions") {
      prompt = `Please extract action items and tasks from the following file. File name: ${fileName}

File content:
${fileContent}

Please list all action items and tasks in English using a numbered list format. If there are no clear action items, please state so.`;
    } else if (kind === "remember") {
      prompt = `Please create a memory summary for the following file for future retrieval. File name: ${fileName}

File content:
${fileContent}

Please create a concise memory summary in English, including:
1. The main theme of the file
2. Key information points
3. Possible tags or keywords

Format it for easy searching and recall.`;
    }

    // Call LLM API
    const response = await invoke<string>("call_llm_api", {
      request: {
        provider: llmSettings.provider,
        apiKey: llmSettings.apiKey,
        model: llmSettings.model,
        prompt: prompt,
        maxTokens: kind === "remember" ? 200 : 500
      }
    });

    return response.trim();
  } catch (error) {
    console.error(`Failed to process ${kind}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Fallback to mock response on error
    return mockResponseText(kind) + `\n\n(Note: LLM API call failed: ${errorMessage})`;
  }
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
  const textRef = useRef<HTMLParagraphElement>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const onCompleteRef = useRef(onComplete);
  const stepTimeoutRef = useRef<number | null>(null);

  // Update onComplete ref when it changes
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    // Find container when component mounts or text changes
    if (textRef.current) {
      // Try to find either .bubble-output or .chat-result-content
      containerRef.current = textRef.current.closest('.bubble-output') as HTMLElement ||
                             textRef.current.closest('.chat-result-content') as HTMLElement;
    }
  }, [text]);

  useEffect(() => {
    // Clear any existing timeout
    if (stepTimeoutRef.current) {
      window.clearTimeout(stepTimeoutRef.current);
      stepTimeoutRef.current = null;
    }

    let index = 0;
    let cancelled = false;

    function step() {
      if (cancelled) return;
      index += 1;
      setDisplayed(text.slice(0, index));
      
      // Auto-scroll to bottom, but throttle it to avoid layout thrashing
      // Only scroll every 100ms or when near the end
      const now = Date.now();
      const shouldScroll = (now - lastScrollTimeRef.current > 100) || (index >= text.length - 5);
      
      if (containerRef.current && shouldScroll) {
        // Use requestAnimationFrame for smoother scrolling
        requestAnimationFrame(() => {
          if (containerRef.current && !cancelled) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
            lastScrollTimeRef.current = now;
          }
        });
      }
      
      if (index >= text.length) {
        // Use ref to call onComplete to avoid dependency issues
        onCompleteRef.current();
        // Final scroll to bottom
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
        return;
      }
      stepTimeoutRef.current = window.setTimeout(step, speedMs);
    }

    setDisplayed("");
    lastScrollTimeRef.current = 0;
    if (text.length > 0) {
      stepTimeoutRef.current = window.setTimeout(step, speedMs);
    }

    return () => {
      cancelled = true;
      if (stepTimeoutRef.current) {
        window.clearTimeout(stepTimeoutRef.current);
        stepTimeoutRef.current = null;
      }
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [text, speedMs]); // Removed onComplete from dependencies

  return <p ref={textRef} className="streaming-text">{displayed}</p>;
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
  const [behaviorAnalysis, setBehaviorAnalysis] = useState<BehaviorAnalysis | null>(null);
  const [userMood, setUserMood] = useState<UserMood>(null);
  const [conversationBubble, setConversationBubble] = useState<ConversationBubble | null>(null);
  const [lastConversationTime, setLastConversationTime] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LlmSettings>(() => {
    // Load from localStorage
    const saved = localStorage.getItem("llmSettings");
    if (saved) {
      try {
        return { ...DEFAULT_LLM_SETTINGS, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_LLM_SETTINGS;
      }
    }
    return DEFAULT_LLM_SETTINGS;
  });
  const [chatDialogVisible, setChatDialogVisible] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatImage, setChatImage] = useState<string | null>(null); // Base64 image data
  const [chatAction, setChatAction] = useState<"explain" | "save" | "reply_email" | null>(null);
  const [chatResult, setChatResult] = useState<string>("");
  const [chatResultExpanded, setChatResultExpanded] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStreamKey, setChatStreamKey] = useState(0);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatImageRef = useRef<HTMLImageElement>(null);

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
  const actionRequestRef = useRef(0);
  const pendingSaveRef = useRef<{
    id: number;
    recordId: number;
    kind: "summarize" | "actions" | "remember";
    text: string;
  } | null>(null);
  const completedStreamIdsRef = useRef<Set<number>>(new Set());
  const successHappyTimeoutRef = useRef<number | null>(null);
  const petClickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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
    const shouldFollowMouse =
      petState === "idle_breathe" ||
      petState === "idle_blink" ||
      petState === "idle" ||
      petState === "waiting_for_drop" ||
      petState === "drool" ||
      petState === "eat_chomp" ||
      petState === "eat_action";

    if (isMuted || !shouldFollowMouse) {
      // Reset eye positions when muted
      const eyeL = bodyLayerRef.current?.querySelector("#eyeLWrap") as SVGElement | null;
      const eyeR = bodyLayerRef.current?.querySelector("#eyeRWrap") as SVGElement | null;
      if (eyeL && eyeR) {
        gsap.set([eyeL, eyeR], { x: 0, y: 0 });
      }
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
      const eyeL = bodyLayerRef.current?.querySelector("#eyeLWrap") as SVGElement | null;
      const eyeR = bodyLayerRef.current?.querySelector("#eyeRWrap") as SVGElement | null;
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
      const eyeL = bodyLayerRef.current?.querySelector("#eyeLWrap") as SVGElement | null;
      const eyeR = bodyLayerRef.current?.querySelector("#eyeRWrap") as SVGElement | null;
      if (eyeL && eyeR) {
        gsap.set([eyeL, eyeR], { x: 0, y: 0 });
      }
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
      const eyeL = bodyLayerRef.current?.querySelector("#eyeLWrap") as SVGElement | null;
      const eyeR = bodyLayerRef.current?.querySelector("#eyeRWrap") as SVGElement | null;
      if (eyeL && eyeR) {
        gsap.set([eyeL, eyeR], { x: 0, y: 0 });
      }
    };
  }, [isMuted, petState]);


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
                // Close chat dialog if open
                setChatDialogVisible(false);
                setChatInput("");
                setChatImage(null);
                setChatAction(null);
                setChatResult("");
                setChatResultExpanded(false);
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
      gsapStateRef.current?.playEat();
    }
  }, [petState, isMuted]);

  useEffect(() => {
    const gsapState = gsapStateRef.current;
    if (!gsapState || isMuted) return;

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
        case "happy":
          return "happy";
        case "error_confused":
        case "angry":
          return "angry";
        case "waiting_for_drop":
        case "drool":
          return "drool";
        case "comfy":
        case "shy":
        case "cry":
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
  }, [petState, isMuted]);

  // 监听 waiting_for_drop 状态，触发等待动画
  useEffect(() => {
    console.log("petState changed to:", petState, "isMuted:", isMuted);
    if (petState === "waiting_for_drop" && !isMuted) {
      console.log("Triggering waiting animation");
      gsapStateRef.current?.setState("drool");
    } else if (petState !== "waiting_for_drop" && mouthLayerRef.current) {
      // 当离开等待状态时，恢复线条并隐藏椭圆，恢复40px尺寸
      const mouth = mouthLayerRef.current;
      gsap.set(mouth, { clearProps: "transform" });
    }
  }, [petState, isMuted]);

  // Listen to behavior analysis and infer user mood
  useEffect(() => {
    if (isMuted) return;

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
  }, [isMuted, userMood]);

  // Trigger proactive conversation based on mood
  useEffect(() => {
    if (isMuted || !userMood || panelVisible) return;
    
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
  }, [userMood, isMuted, panelVisible, lastConversationTime, behaviorAnalysis, llmSettings]);

  // Save LLM settings to localStorage
  const saveLlmSettings = (settings: LlmSettings) => {
    setLlmSettings(settings);
    localStorage.setItem("llmSettings", JSON.stringify(settings));
  };

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
    
    // Don't auto-close if there's active content (streaming or completed text)
    // Only auto-close if panel is empty or user is idle
    const checkAndClose = () => {
      // If there's panelMode, it means user clicked an action button
      // If there's panelText, it means there's content (streaming or completed)
      // Don't close in these cases
      if (panelMode || panelText) {
        return;
      }
      
      // Only close if panel is truly empty (no action, no text)
      setPanelVisible(false);
      setPanelMode(null);
      setPanelText("");
    };
    
    // Check after 30 seconds, and only close if no content
    const timer = window.setTimeout(checkAndClose, 30000);

    return () => window.clearTimeout(timer);
  }, [panelVisible, panelMode, panelText]);

  useOutsideClick(panelRef, () => {
    if (panelVisible) {
      if (Date.now() < panelLockUntil) return;
      // Don't close if there's active content (streaming or completed text)
      // Only close if panel is empty
      if (panelMode || panelText) {
        return;
      }
      setPanelVisible(false);
      setPanelMode(null);
      setPanelText("");
    }
  });

  useEffect(() => {
    // Determine target window size based on state
    let next;
    if (panelVisible || settingsVisible || chatDialogVisible) {
      next = WINDOW_EXPANDED; // Full expansion when panel, settings, or chat dialog is visible
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
    root.style.setProperty("--window-height", `${next.height}px`);

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
  }, [panelVisible, settingsVisible, chatDialogVisible, currentWindowSize]);


  // Update CSS variable on window resize
  useEffect(() => {
    const updateWindowWidth = () => {
      const root = document.documentElement;
      root.style.setProperty("--window-width", `${currentWindowSize.width}px`);
    };
    updateWindowWidth();
  }, [currentWindowSize]);

  useEffect(() => {
    if (!bodyLayerRef.current) return;
    const svg = bodyLayerRef.current.querySelector("svg");
    if (!svg) return;
    const q = gsap.utils.selector(svg);
    const eyeBlinkTargets = q("#eyeL, #eyeR");
    const eyeLidTargets = q("#eyeLidL, #eyeLidR");
    const eyeMoveTargets = q("#eyeLWrap, #eyeRWrap");
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

      gsap.set(q("#eyesCircle"), { opacity: 1 });
      gsap.set(q("#eyesCry"), { opacity: 0 });
      gsap.set(q("#eyesStar"), { opacity: 0 });
      gsap.set(eyeMoveTargets, { x: 0, y: 0 });
      gsap.set(eyeBlinkTargets, { scaleY: 1, opacity: 1 });
      gsap.set(eyeLidTargets, { opacity: 0 });

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
          .set(eyeBlinkTargets, { opacity: 1 })
          .set(eyeLidTargets, { opacity: 0 })
          .to(eyeBlinkTargets, { opacity: 0, duration: 0.04, ease: "power1.in" })
          .to(eyeLidTargets, { opacity: 1, duration: 0.04, ease: "power1.in" }, "<")
          .to(eyeLidTargets, { opacity: 0, duration: 0.06, ease: "power1.out" })
          .to(eyeBlinkTargets, { opacity: 1, duration: 0.06, ease: "power1.out" }, "<");
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
            .to(eyeMoveTargets, { x: 5, y: -1, duration: 0.35 }, 0)
            .to(eyeMoveTargets, { x: 2, y: 0, duration: 0.55 }, 0.35)
            .to(eyeMoveTargets, { x: 5, y: -1, duration: 0.55 }, 0.9);
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
        case "happy": {
          stateTL = gsap.timeline({ defaults: { ease: "sine.inOut" } })
            .to(q("#bunWrap"), { scaleX: 1.03, scaleY: 0.97, duration: 0.18 }, 0)
            .to(q("#face"), { y: -2, duration: 0.18 }, 0)
            .to(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" }, duration: 0.14 }, 0)
            .to(eyeMoveTargets, { y: 2, duration: 0.18 }, 0)
            .to(q("#bunWrap"), { scaleX: 1, scaleY: 1, duration: 0.28, ease: "elastic.out(1,0.55)" }, 0.18);
          break;
        }
        case "comfy": {
          gsap.set(eyeBlinkTargets, { scaleY: 0.2 });
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
          gsap.set(q("#blush"), { opacity: 0.8, scale: 0.95 });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#face"), { x: -2, y: 1, duration: 0.6 }, 0)
            .to(q("#face"), { x: 2, y: 1, duration: 0.6 }, 0.6);
          break;
        }
        case "cry": {
          gsap.set(q("#eyesCircle"), { opacity: 0 });
          gsap.set(q("#eyesCry"), { opacity: 1 });
          gsap.set(q("#tears"), { opacity: 1 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthCry, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ repeat: -1, defaults: { ease: "sine.inOut" } })
            .to(tearTargets, { y: 6, duration: 0.6 }, 0)
            .to(tearTargets, { y: 0, duration: 0.6 }, 0.6);
          break;
        }
        case "drool": {
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthO, shapeIndex: "auto" }, fill: "url(#mouthGrad)", strokeWidth: 0 });
          gsap.set(q("#drool"), { opacity: 1 });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#drool"), { scaleY: 1.2, duration: 0.8 }, 0);
          break;
        }
        case "excited": {
          gsap.set(q("#eyesCircle"), { opacity: 0 });
          gsap.set(q("#eyesStar"), { opacity: 1 });
          stateTL = gsap.timeline({ repeat: -1, defaults: { ease: "power1.inOut" } })
            .to(q("#bunWrap"), { y: -6, duration: 0.18 }, 0)
            .to(q("#bunWrap"), { y: 0, duration: 0.22 }, 0.18);
          break;
        }
        case "tired": {
          gsap.set(eyeBlinkTargets, { scaleY: 0.25 });
          gsap.set(eyeMoveTargets, { y: 3 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthFlat, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#bunWrap"), { y: 6, scaleX: 1.015, scaleY: 0.985, duration: 1.2 }, 0)
            .to(q("#face"), { y: 3.5, rotation: -1.2, duration: 1.2 }, 0)
            .to(q("#bunWrap"), { y: 2, scaleX: 1.0, scaleY: 1.0, duration: 1.2 }, 1.2)
            .to(q("#face"), { y: 2.0, rotation: 1.0, duration: 1.2 }, 1.2);
          break;
        }
        case "angry": {
          gsap.set(q("#brows"), { opacity: 1 });
          stateTL = gsap.timeline({ defaults: { ease: "power2.out" } })
            .to(q("#mouth"), { morphSVG: { shape: shapes.mouthAngry, shapeIndex: "auto" }, duration: 0.16 }, 0)
            .to(q("#browL"), { rotation: -18, y: 4, duration: 0.18, transformOrigin: "50% 50%" }, 0)
            .to(q("#browR"), { rotation: 18, y: 4, duration: 0.18, transformOrigin: "50% 50%" }, 0)
            .to(q("#face"), { x: 1.2, duration: 0.06 }, 0.18)
            .to(q("#face"), { x: -1.2, duration: 0.06, repeat: 3, yoyo: true }, 0.24)
            .to(q("#face"), { x: 0, duration: 0.08 }, 0.54);
          break;
        }
        case "surprised": {
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthO, shapeIndex: "auto" }, fill: "url(#mouthGrad)", strokeWidth: 0 });
          gsap.set(eyeBlinkTargets, { scaleY: 1.2 });
          break;
        }
        case "sleepy": {
          gsap.set(eyeBlinkTargets, { scaleY: 0.18 });
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthSleep, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ defaults: { ease: "sine.inOut" } })
            .to(q("#face"), { y: 2, duration: 0.18 }, 0)
            .to(q("#face"), { y: 5, duration: 0.8 }, 0.18)
            .to(q("#face"), { y: 2, duration: 0.8 }, 0.98);
          break;
        }
        case "chew": {
          gsap.set(q("#mouth"), { morphSVG: { shape: shapes.mouthO, shapeIndex: "auto" } });
          stateTL = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
            .to(q("#mouth"), { morphSVG: { shape: shapes.mouthSmile, shapeIndex: "auto" }, duration: 0.18 }, 0)
            .to(q("#mouth"), { morphSVG: { shape: shapes.mouthO, shapeIndex: "auto" }, duration: 0.18 }, 0.18);
          break;
        }
        default:
          break;
      }
    };

    gsap.set(q("#bunWrap"), { transformOrigin: "50% 80%", svgOrigin: "260 320" });
    gsap.set(eyeBlinkTargets, { transformOrigin: "50% 50%", transformBox: "fill-box" });
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
    return;
    // Legacy implementation (kept for reference; replaced by GSAP example state machine)
    if (!petWrapperRef.current || !bodyLayerRef.current || !mouthLayerRef.current || !eyesLayerRef.current || !tailLayerRef.current) return;

    const wrapper = petWrapperRef.current;
    const body = bodyLayerRef.current;
    const mouth = mouthLayerRef.current;
    const eyes = eyesLayerRef.current;
    const tail = tailLayerRef.current;
    const pupils = eyes.querySelectorAll(".pet-pupil");
    const bunPath = body.querySelector(".bun-shape") as SVGPathElement | null;
    const mouthLine = mouth.querySelector(".mouth-line") as SVGPathElement | null;
    const mouthOpen = mouth.querySelector(".mouth-open") as SVGPathElement | null;

    // 安全防御：关键元素缺失则不执行动画
    if (!bunPath || !mouthLine || !mouthOpen) {
      return;
    }

    // 重置到静止状态（对应 swallow_gsap 的 resetAll）
    const resetToInitial = () => {
      gsap.set(wrapper, {
        clearProps: "transform"
      });
      gsap.set(body, {
        clearProps: "transform"
      });
      gsap.set(tail, {
        rotation: 25
      });

      // 团子外形恢复为基础 path（不做 morph，只重置）
      bunPath.setAttribute(
        "d",
        "M120 320 C120 245 190 175 260 176 C330 175 400 245 400 320 Q400 345 376 352 C330 368 190 368 144 352 Q120 345 120 320 Z"
      );

      // 嘴巴恢复为细线微笑
      mouthLine.style.display = "";
      mouthLine.setAttribute("d", "M220 275 Q260 295 300 275 Q260 286 220 275 Z");
      mouthLine.setAttribute("stroke-width", "5");

      mouthOpen.style.display = "none";
      gsap.set(mouthOpen, { scaleX: 1, scaleY: 1, transformOrigin: "50% 50%" });

      // 眼睛位置恢复
      pupils.forEach((pupil) => {
        const { x: currentX, y: currentY } = getPupilOffset(pupil);
        setPupilOffset(pupil, currentX, currentY);
      });
    };

    resetToInitial();

    // GSAP 吞咽时间线（参考 examples/swallow_gsap.html，做简化版）
    const tl = gsap.timeline({
      defaults: { ease: "power2.inOut" }
    });

    // 0) 轻微蓄力：整体团子被压扁一点
    tl.to(
      wrapper,
      {
        scaleX: 1.04,
        scaleY: 0.96,
        duration: 0.12,
        transformOrigin: "50% 80%"
      },
      0
    );

    // 1) 张嘴：脸微微下移 + 嘴从线条切换到大嘴洞
    // 眼睛往下看一点，像在看要吃的东西
    pupils.forEach((pupil) => {
      const { x: currentX, y: currentY } = getPupilOffset(pupil);
      const data = { y: currentY };
      tl.to(
        data,
        {
          y: currentY + 8,
          duration: 0.16,
          ease: "power2.out",
          onUpdate: () => {
            const y = data.y;
            setPupilOffset(pupil, currentX, y);
          }
        },
        0.04
      );
    });

    // 切换到大嘴洞
    tl.add(() => {
      mouthLine.style.display = "none";
      mouthOpen.style.display = "";
    }, 0.04);

    // 大嘴洞放大一点，像真正张开
    tl.fromTo(
      mouthOpen,
      {
        scaleX: 0.9,
        scaleY: 0.9,
        transformOrigin: "50% 50%"
      },
      {
        scaleX: 1.05,
        scaleY: 1.15,
        duration: 0.18,
        ease: "power2.out"
      },
      0.04
    );

    // 2) 吞咽：团子底部轻微鼓起 + 身体有一点点上下起伏
    tl.to(
      wrapper,
      {
        y: -4,
        duration: 0.18,
        ease: "power1.inOut"
      },
      0.22
    );
    tl.to(
      wrapper,
      {
        y: 0,
        duration: 0.24,
        ease: "power1.out"
      },
      0.4
    );

    // 尾巴跟着轻轻摇一下
    tl.to(
      tail,
      {
        rotate: 30,
        duration: 0.18,
        ease: "sine.inOut"
      },
      0.22
    ).to(
      tail,
      {
        rotate: 22,
        duration: 0.24,
        ease: "sine.inOut"
      },
      0.4
    );

    // 3) 合嘴回微笑
    tl.to(
      mouthOpen,
      {
        scaleX: 0.9,
        scaleY: 0.8,
        duration: 0.14,
        ease: "power2.inOut"
      },
      0.46
    );

    tl.add(() => {
      mouthOpen.style.display = "none";
      mouthLine.style.display = "";
      mouthLine.setAttribute("stroke-width", "5");
    }, 0.62);

    // 身体回弹到原始状态
    tl.to(
      wrapper,
      {
        scaleX: 1,
        scaleY: 1,
        duration: 0.26,
        ease: "elastic.out(1, 0.6)"
      },
      0.6
    );

    // 动画结束后再做一次轻微 reset，确保状态完全干净
    tl.add(() => {
      resetToInitial();
    }, 0.95);
  }

  function triggerWaitingAnimation() {
    console.log("triggerWaitingAnimation called");
    gsapStateRef.current?.setState("drool");
    return;
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
    const mouthState = mouth as SVGGElement & {
      __waitingMouthTween?: gsap.core.Tween | gsap.core.Timeline;
      __waitingBodyTween?: gsap.core.Tween | gsap.core.Timeline;
      __waitingEyeTweens?: gsap.core.Tween[];
      __waitingTailTween?: gsap.core.Tween;
      __waitingAnimation?: { pause: () => void };
    };

    if (mouthState.__waitingAnimation) {
      try {
        mouthState.__waitingAnimation.pause();
      } catch (e) {
        // 忽略错误
      }
      delete mouthState.__waitingAnimation;
    }
    mouthState.__waitingMouthTween?.kill();
    mouthState.__waitingBodyTween?.kill();
    mouthState.__waitingTailTween?.kill();
    mouthState.__waitingEyeTweens?.forEach((tween) => tween.kill());

    // 等待状态：嘴巴张开，眼睛期待地看着
    // 眼睛稍微向下看（期待食物）
    const eyeTweens: gsap.core.Tween[] = [];
    pupils.forEach((pupil) => {
      const { x: currentX, y: currentY } = getPupilOffset(pupil);
      const target = { y: currentY };
      const tween = gsap.to(target, {
        y: 6,
        duration: 0.3,
        ease: "power2.out",
        onUpdate: () => {
          const y = target.y;
          setPupilOffset(pupil, currentX, y);
        }
      });
      eyeTweens.push(tween);
    });
    mouthState.__waitingEyeTweens = eyeTweens;

    const mouthLine = mouth.querySelector('.mouth-line') as SVGPathElement | null;
    const openPath = mouth.querySelector('.mouth-open') as SVGPathElement | null;

    if (mouthLine) {
      mouthLine.style.display = 'none';
    }
    if (openPath) {
      openPath.style.display = '';
      gsap.set(openPath, { scaleX: 1, scaleY: 1, transformOrigin: "50% 50%" });
    }

    if (openPath) {
      const breathingTl = gsap.timeline({
        repeat: -1,
        yoyo: true,
        defaults: { ease: "sine.inOut", duration: 0.7 }
      });
      breathingTl.to(wrapper, { scaleX: 1.05, scaleY: 0.95, transformOrigin: "50% 75%" }, 0);
      breathingTl.to(eyes, { y: 4 }, 0);
      breathingTl.to(mouth, { y: 6 }, 0);
      breathingTl.to(openPath, { scaleX: 1.04, scaleY: 1.16, transformOrigin: "50% 50%" }, 0);

      mouthState.__waitingMouthTween = breathingTl;
      mouthState.__waitingBodyTween = breathingTl;
      console.log("GSAP waiting animation started");
    } else {
      console.error("Failed to create or find open mouth path");
    }

    // 尾巴轻微摆动（期待的样子）
    const tailTween = gsap.to(tail, {
      rotate: 28,
      duration: 0.9,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true
    });
    mouthState.__waitingTailTween = tailTween;
  }

  function triggerExpressionAnimation(kind: "summarize" | "actions" | "remember") {
    if (gsapStateRef.current) {
      const stateMap = {
        summarize: "think",
        actions: "happy",
        remember: "comfy"
      } as const;
      gsapStateRef.current.setState(stateMap[kind]);
      return;
    }
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
        translateX: 0,
        translateY: 0,
        duration: 0
      });
      // 确保嘴巴恢复为线条（隐藏大嘴洞，显示线条）
      const mouthLine = mouth.querySelector('.mouth-line') as SVGPathElement | null;
      const mouthOpen = mouth.querySelector('.mouth-open') as SVGPathElement | null;
      if (mouthLine) {
        mouthLine.style.display = '';
      }
      if (mouthOpen) {
        mouthOpen.style.display = 'none';
      }
      animate(tail, {
        rotate: 25,
        duration: 0
      });
      pupils.forEach((pupil) => {
        setPupilState(pupil, 0, 0, 1);
      });
    };

    if (kind === "summarize") {
      // 总结：思考表情 - 眼睛向上看，嘴巴稍微张开，身体轻微前倾
      resetAll();
      
      // 眼睛向上看
      pupils.forEach((pupil) => {
        const { x: currentX, y: currentY } = getPupilOffset(pupil);
        const target = { y: currentY };
        animate(target, {
          y: -6,
          duration: 300,
          ease: "outQuad",
          update: () => {
            const y = target.y;
            setPupilOffset(pupil, currentX, y);
          }
        });
      });

      // 嘴巴稍微张开（思考状）
      // 保持 translateX(-50%) 以确保居中（嘴巴宽度40px，-50% = -20px）
      animate(mouth, {
        scaleY: 1.3,
        scaleX: 0.9,
        translateX: 0,
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
        const { x: currentX, y: currentY } = getPupilOffset(pupil);
        const target = { scale: 1 };
        animate(target, {
          scale: 1.15,
          duration: 250,
          ease: "outQuad",
          update: () => {
            setPupilState(pupil, currentX, currentY, target.scale);
          }
        });
      });

      // 嘴巴紧闭（专注状）
      // 保持 translateX(-50%) 以确保居中（嘴巴宽度40px，-50% = -20px）
      animate(mouth, {
        scaleY: 0.7,
        scaleX: 1.1,
        translateX: 0,
        translateY: 0,
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
        const { x: currentX, y: currentY } = getPupilOffset(pupil);
        const target = { y: currentY, scale: 1 };
        animate(target, {
          y: -4,
          scale: 0.85,
          duration: 350,
          ease: "outQuad",
          update: () => {
            setPupilState(pupil, currentX, target.y, target.scale);
          }
        });
      });

      // 眼睛整体缩小（眯眼效果）- 已通过瞳孔缩放处理

      // 嘴巴微笑（向上弯曲）
      // 保持 translateX(-50%) 以确保居中（嘴巴宽度40px，-50% = -20px）
      animate(mouth, {
        scaleY: 0.8,
        scaleX: 1.2,
        translateX: 0,
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
    
    // Check if API key is configured, if not, open settings panel
    if (!llmSettings.apiKey) {
      setSettingsVisible(true);
      setPanelMode(null);
      setPanelText("");
      return;
    }
    
    // Clear any existing success_happy timeout
    if (successHappyTimeoutRef.current) {
      window.clearTimeout(successHappyTimeoutRef.current);
      successHappyTimeoutRef.current = null;
    }
    
    actionRequestRef.current += 1;
    const requestId = actionRequestRef.current;
    setPanelMode(kind);
    setPetState("thinking");
    
    // 触发对应选项的表情动画
    triggerExpressionAnimation(kind);
    
    void (async () => {
      const nextText = await getResponseText(kind, dropRecord.path, llmSettings);
      if (requestId !== actionRequestRef.current) return;
      setPanelText(nextText);
      setStreamKey(requestId);
      // Clear completed streamIds for the new request
      completedStreamIdsRef.current.delete(requestId);
      pendingSaveRef.current = {
        id: requestId,
        recordId: dropRecord.id,
        kind,
        text: nextText
      };
    })();
  }

  function handleStreamComplete(streamId: number) {
    // Prevent duplicate calls for the same streamId
    if (completedStreamIdsRef.current.has(streamId)) {
      console.log("handleStreamComplete already called for streamId:", streamId);
      return;
    }
    completedStreamIdsRef.current.add(streamId);
    
    // Clear any existing success_happy timeout
    if (successHappyTimeoutRef.current) {
      window.clearTimeout(successHappyTimeoutRef.current);
      successHappyTimeoutRef.current = null;
    }
    
    const pending = pendingSaveRef.current;
    if (pending && pending.id === streamId && pending.recordId > 0) {
      void invoke("save_mock_result", {
        recordId: pending.recordId,
        kind: pending.kind,
        content: pending.text
      });
    }
    
    // Only change state if we're currently in thinking state
    if (petState !== "thinking") {
      console.log("handleStreamComplete called but petState is not thinking:", petState);
      return;
    }
    
    // 重置所有动画到初始状态
    if (petWrapperRef.current && bodyLayerRef.current && mouthLayerRef.current && eyesLayerRef.current && tailLayerRef.current) {
      const wrapper = petWrapperRef.current;
      const body = bodyLayerRef.current;
      const mouth = mouthLayerRef.current;
      const eyes = eyesLayerRef.current;
      const tail = tailLayerRef.current;
      const pupils = eyes.querySelectorAll('.pet-pupil');

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
        translateX: 0,
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
        const { x: currentX, y: currentY, scale } = getPupilState(pupil);
        const target = { x: currentX, y: currentY, scale };
        animate(target, {
          x: 0,
          y: 0,
          scale: 1,
          duration: 400,
          ease: "outQuad",
          update: () => {
            setPupilState(pupil, target.x, target.y, target.scale);
          }
        });
      });
    }
    
    setPetState("success_happy");
    successHappyTimeoutRef.current = window.setTimeout(() => {
      setPetState("idle_breathe");
      successHappyTimeoutRef.current = null;
    }, 1200);
  }

  // Handle image paste
  const handleImagePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64 = e.target?.result as string;
            setChatImage(base64);
          };
          reader.readAsDataURL(blob);
        }
        event.preventDefault();
        break;
      }
    }
  };

  // Handle chat action
  const handleChatAction = async (action: "explain" | "save" | "reply_email") => {
    if (!llmSettings.apiKey) {
      setSettingsVisible(true);
      return;
    }

    if (!chatInput.trim() && !chatImage) {
      return;
    }

    setChatAction(action);
    setChatLoading(true);
    setChatResult("");
    setChatResultExpanded(false);
    setPetState("thinking");

    try {
      let prompt = "";
      if (action === "explain") {
        prompt = chatImage 
          ? `Please explain the content of this image in detail (in English, clear and easy to understand):\n\nUser input: ${chatInput.trim() || "None"}`
          : `Please explain the following content in detail (in English, clear and easy to understand):\n\n${chatInput.trim()}`;
      } else if (action === "save") {
        prompt = chatImage
          ? `Please save the key information from this image (in English, concise notes for easy retrieval):\n\nUser input: ${chatInput.trim() || "None"}`
          : `Please save the key information from the following content (in English, concise notes for easy retrieval):\n\n${chatInput.trim()}`;
      } else if (action === "reply_email") {
        prompt = chatImage
          ? `Please help me write a reply email based on this image and user input (in English, professional and polite):\n\nUser input: ${chatInput.trim() || "None"}`
          : `Please help me write a reply email based on the following content (in English, professional and polite):\n\n${chatInput.trim()}`;
      }

      // For images, we need to send base64 data to LLM
      // Note: Most LLM APIs support base64 images in the prompt or as a separate parameter
      // For now, we'll send the text prompt with a note about the image
      if (chatImage) {
        prompt += "\n\n[Note: An image has been attached, but the current implementation only processes text prompts]";
      }

      const response = await invoke<string>("call_llm_api", {
        request: {
          provider: llmSettings.provider,
          apiKey: llmSettings.apiKey,
          model: llmSettings.model,
          prompt: prompt,
          maxTokens: 500
        }
      });

      setChatResult(response.trim());
      setChatResultExpanded(true);
      setChatStreamKey(prev => prev + 1);
      setPetState("success_happy");
      setTimeout(() => setPetState("idle_breathe"), 1200);
    } catch (error) {
      console.error("Failed to process chat action:", error);
      setChatResult("Sorry, processing failed. Please check your API Key configuration.");
      setChatResultExpanded(true);
      setPetState("error_confused");
      setTimeout(() => setPetState("idle_breathe"), 1200);
    } finally {
      setChatLoading(false);
    }
  };

  // Reset to initial state function (for pet click)
  const resetToInitialOnClick = () => {
    setPanelVisible(false);
    setPanelMode(null);
    setPanelText("");
    setDropRecord(null);
    setPetState("idle_breathe");
    setSettingsVisible(false);
    setConversationBubble(null);
    setChatDialogVisible(false);
    setChatInput("");
    setChatImage(null);
    setChatAction(null);
    setChatResult("");
    setChatResultExpanded(false);
    
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
            // If in initial state (no panel, no settings, no chat dialog), show chat dialog
            else if (!panelVisible && !settingsVisible && !chatDialogVisible && petState === "idle_breathe") {
              // Close file panel if open
              setPanelVisible(false);
              setPanelMode(null);
              setPanelText("");
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
        className={`pet-stage ${panelVisible || settingsVisible || chatDialogVisible ? "panel-open" : ""} ${
          (panelVisible || settingsVisible || chatDialogVisible) && !isExpanded ? "panel-fallback" : ""
        }`}
      >
        <div className="pet-drag-hint">Drop files here</div>
        <div
          ref={petWrapperRef}
          className="pet-wrapper"
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
                    <g id="eyeLWrap">
                      <circle id="eyeL" cx="205" cy="230" r="10" fill="#584030" />
                      <path id="eyeLidL" d="M195 230 Q205 230 215 230" fill="none" stroke="#584030" strokeWidth="8" strokeLinecap="round" opacity="0" />
                    </g>
                    <g id="eyeRWrap">
                      <circle id="eyeR" cx="315" cy="230" r="10" fill="#584030" />
                      <path id="eyeLidR" d="M305 230 Q315 230 325 230" fill="none" stroke="#584030" strokeWidth="8" strokeLinecap="round" opacity="0" />
                    </g>
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
        {chatDialogVisible && (
          <div className={`bubble-panel chat-dialog`} data-no-drag>
            <div className="bubble-header">
              <span>💬 Chat with Papa</span>
            </div>
            <div className="chat-content">
              <div className="chat-input-wrapper">
                {chatImage && (
                  <div className="chat-image-preview">
                    <img ref={chatImageRef} src={chatImage} alt="Pasted" />
                    <button
                      className="chat-image-remove"
                      onClick={() => setChatImage(null)}
                      data-no-drag
                    >
                      ×
                    </button>
                  </div>
                )}
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPaste={handleImagePaste}
                  placeholder={llmSettings.apiKey ? "Say something to Papa..." : "API Key required"}
                  className="chat-input"
                  disabled={chatLoading || !llmSettings.apiKey}
                  data-no-drag
                />
                <div className="chat-actions">
                  <button
                    onClick={() => handleChatAction("explain")}
                    disabled={chatLoading || (!chatInput.trim() && !chatImage) || !llmSettings.apiKey}
                    className="chat-action-button"
                    data-no-drag
                  >
                    Explain
                  </button>
                  <button
                    onClick={() => handleChatAction("save")}
                    disabled={chatLoading || (!chatInput.trim() && !chatImage) || !llmSettings.apiKey}
                    className="chat-action-button"
                    data-no-drag
                  >
                    Save
                  </button>
                  <button
                    onClick={() => handleChatAction("reply_email")}
                    disabled={chatLoading || (!chatInput.trim() && !chatImage) || !llmSettings.apiKey}
                    className="chat-action-button"
                    data-no-drag
                  >
                    Reply Email
                  </button>
                </div>
              </div>
              {chatResult && (
                <div className="chat-result-container">
                  <button
                    className="chat-result-header"
                    onClick={() => setChatResultExpanded(!chatResultExpanded)}
                    data-no-drag
                  >
                    <span>{chatAction === "explain" ? "Explain" : chatAction === "save" ? "Save" : "Reply Email"}</span>
                    <span className="chat-result-toggle">{chatResultExpanded ? "▼" : "▶"}</span>
                  </button>
                  {chatResultExpanded && (
                    <div className="chat-result-content">
                      <StreamingText
                        key={`chat-${chatAction}-${chatStreamKey}`}
                        text={chatResult}
                        speedMs={22}
                        onComplete={() => {}}
                      />
                    </div>
                  )}
                </div>
              )}
              {chatLoading && (
                <div className="chat-loading">Thinking...</div>
              )}
            </div>
          </div>
        )}
        {settingsVisible && (
          <div className={`bubble-panel settings-panel`} data-no-drag>
            <div className="bubble-header">
              <span>Settings</span>
              <button
                className="close-button"
                onClick={() => setSettingsVisible(false)}
                data-no-drag
              >
                ×
              </button>
            </div>
            <div className="settings-content">
              <div className="settings-section">
                <label className="settings-label">LLM Provider</label>
                <select
                  value={llmSettings.provider}
                  onChange={(e) =>
                    saveLlmSettings({
                      ...llmSettings,
                      provider: e.target.value as "openai" | "anthropic",
                      model: LLM_MODELS[e.target.value as "openai" | "anthropic"][0]
                    })
                  }
                  className="settings-input"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              
              <div className="settings-section">
                <label className="settings-label">Model</label>
                <select
                  value={llmSettings.model}
                  onChange={(e) =>
                    saveLlmSettings({
                      ...llmSettings,
                      model: e.target.value
                    })
                  }
                  className="settings-input"
                >
                  {LLM_MODELS[llmSettings.provider].map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="settings-section">
                <label className="settings-label">API Key</label>
                <input
                  type="password"
                  value={llmSettings.apiKey}
                  onChange={(e) =>
                    saveLlmSettings({
                      ...llmSettings,
                      apiKey: e.target.value
                    })
                  }
                  placeholder="Enter your API key"
                  className="settings-input"
                />
                <div className="settings-hint">
                  {llmSettings.apiKey
                    ? "✓ API key configured"
                    : "⚠️ API key required for LLM conversations"}
                </div>
              </div>
              
              <div className="settings-section">
                <button
                  className="settings-save-button"
                  onClick={() => setSettingsVisible(false)}
                >
                  Save & Close
                </button>
              </div>
            </div>
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
        <button
          className="settings-toggle"
          data-no-drag
          onClick={() => setSettingsVisible((prev) => !prev)}
        >
          ⚙️ Settings
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
              "idle",
              "think",
              "happy",
              "comfy",
              "shy",
              "cry",
              "drool",
              "excited",
              "tired",
              "angry",
              "surprised",
              "sleepy",
              "chew",
              "eat_action",
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
