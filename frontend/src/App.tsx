import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { ChatInput } from "./components/chat/ChatInput";
import { ChatMessageList } from "./components/chat/ChatMessageList";
import { LoadingSkeleton } from "./components/common/LoadingSkeleton";
import {
  ToolActivityIndicator,
  type ToolActivityPhase,
  type ToolRun,
} from "./components/chat/ToolActivityIndicator";
import { SessionCreateForm } from "./components/sessions/SessionCreateForm";
import { SessionList } from "./components/sessions/SessionList";
import { OnboardingModal, type OnboardingFormValues } from "./components/user/OnboardingModal";
import { ContentDisplay } from "./components/workspace/ContentDisplay";
import { IdeaCard } from "./components/workspace/IdeaCard";
import { PlanCard } from "./components/workspace/PlanCard";
import { WorkspaceTabs, type WorkspaceTab } from "./components/workspace/WorkspaceTabs";
import {
  ApiRequestError,
  type ContentItemDto,
  type ContentUpdateRequest,
  createSession,
  getUserContext,
  deletePlan,
  listContentItems,
  listPlans,
  listSessionMessages,
  listSessions,
  sendAgentChat,
  startSessionFromPlan,
  upsertUserOnboarding,
  updateContentItem,
  updatePlan,
  type MessageDto,
  type PlanUpdateRequest,
  type PlanDto,
  type SessionDto,
  type UserContextDto,
} from "./lib/api";
import { connectLiveStream } from "./lib/sse";

const ACTIVE_SESSION_STORAGE_KEY = "kaka_writer_active_session_id";
const USER_ID_STORAGE_KEY = "kaka_writer_user_id";
const TEMP_SESSION_ID_PREFIX = "temp-session-";
const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_WORKSPACE_WIDTH = 390;
const MIN_WORKSPACE_WIDTH = 280;
const MIN_CHAT_WIDTH = 420;
const HIDE_WORKSPACE_BUTTON_MIN_WIDTH = 360;

function isTemporarySessionId(sessionId: string): boolean {
  return sessionId.startsWith(TEMP_SESSION_ID_PREFIX);
}

function isValidPersistedSessionId(sessionId: string): boolean {
  return UUID_V4_LIKE_PATTERN.test(sessionId);
}

function mergeMessages(existing: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map<string, MessageDto>();
  for (const message of existing) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function isMatchingOptimisticUserMessage(message: MessageDto, incomingMessage: MessageDto): boolean {
  return (
    incomingMessage.role === "user" &&
    message.role === "user" &&
    message.id.startsWith("local-") &&
    message.conversation_id === incomingMessage.conversation_id &&
    normalizeMessageContent(message.content) === normalizeMessageContent(incomingMessage.content)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asMessageDto(value: unknown): MessageDto | null {
  const candidate = asRecord(value);
  if (!candidate) {
    return null;
  }
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.conversation_id !== "string" ||
    typeof candidate.role !== "string" ||
    typeof candidate.content !== "string" ||
    typeof candidate.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    conversation_id: candidate.conversation_id,
    role: candidate.role,
    content: candidate.content,
    tool_calls: (candidate.tool_calls as Record<string, unknown> | null) ?? null,
    tool_results: (candidate.tool_results as Record<string, unknown> | null) ?? null,
    context_used: (candidate.context_used as Record<string, unknown> | null) ?? null,
    created_at: candidate.created_at,
  };
}

function parseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function pickInitialActiveSessionId(sessions: SessionDto[]): string | null {
  const savedActiveSessionId = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  if (
    savedActiveSessionId &&
    isValidPersistedSessionId(savedActiveSessionId) &&
    sessions.some((session) => session.id === savedActiveSessionId)
  ) {
    return savedActiveSessionId;
  }
  return sessions[0]?.id ?? null;
}

function upsertToolRun(
  previous: ToolRun[],
  next: {
    toolUseId: string;
    toolName: string;
    iteration: number;
    status: ToolRun["status"];
    details?: string;
    error?: string;
  },
): ToolRun[] {
  const index = previous.findIndex((tool) => tool.toolUseId === next.toolUseId);
  const entry: ToolRun = {
    toolUseId: next.toolUseId,
    toolName: next.toolName,
    iteration: next.iteration,
    status: next.status,
    details: next.details,
    error: next.error,
  };

  if (index === -1) {
    return [...previous, entry];
  }

  const updated = [...previous];
  updated[index] = { ...updated[index], ...entry };
  return updated;
}

function getToolActivityMessage(data: Record<string, unknown> | null): string | undefined {
  if (!data) {
    return undefined;
  }
  const message = data.activity_message;
  if (typeof message !== "string") {
    return undefined;
  }
  const trimmed = message.trim();
  return trimmed || undefined;
}

function buildExecutePlanRequestMessage(
  params: {
    planTitle: string;
    researchNotes: string | null;
    writingInstructions?: string | null;
  },
): string {
  const { planTitle, researchNotes, writingInstructions } = params;
  const normalizedNotes = researchNotes?.trim() || "None provided.";
  const instructions = writingInstructions?.trim();
  const lines = [
    "Execute the approved plan and generate the full blog now.",
    "Use execute_plan for the current session's approved plan.",
    `Plan title: ${planTitle}`,
    `Research focus: ${normalizedNotes}`,
    "Output format: markdown.",
  ];
  if (instructions) {
    lines.push(`Writing instructions: ${instructions}`);
  }
  return lines.join("\n");
}

function upsertPlanById(plans: PlanDto[], nextPlan: PlanDto): PlanDto[] {
  let found = false;
  const next = plans.map((plan) => {
    if (plan.id !== nextPlan.id) {
      return plan;
    }
    found = true;
    return nextPlan;
  });
  return found ? next : [nextPlan, ...next];
}

function reinsertPlanAtIndex(list: PlanDto[], plan: PlanDto, index: number): PlanDto[] {
  if (list.some((item) => item.id === plan.id)) {
    return list;
  }
  if (index < 0) {
    return [plan, ...list];
  }
  const safeIndex = Math.min(index, list.length);
  const next = [...list];
  next.splice(safeIndex, 0, plan);
  return next;
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export default function App() {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [userContext, setUserContext] = useState<UserContextDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [ideaPlans, setIdeaPlans] = useState<PlanDto[]>([]);
  const [contentItems, setContentItems] = useState<ContentItemDto[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("plan");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "reconnecting" | "disconnected">(
    "connecting",
  );
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const needsStreamResyncRef = useRef(false);
  const [agentState, setAgentState] = useState("Idle");
  const [toolActivityPhase, setToolActivityPhase] = useState<ToolActivityPhase>("idle");
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [expectedToolCount, setExpectedToolCount] = useState(0);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingIdeaPlans, setLoadingIdeaPlans] = useState(false);
  const [loadingContentItems, setLoadingContentItems] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [savingContentId, setSavingContentId] = useState<string | null>(null);
  const [regeneratingContentId, setRegeneratingContentId] = useState<string | null>(null);
  const [executingPlanId, setExecutingPlanId] = useState<string | null>(null);
  const [startingSessionPlanId, setStartingSessionPlanId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSessionsCollapsed, setIsSessionsCollapsed] = useState(false);
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(DEFAULT_WORKSPACE_WIDTH);
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const [isBrainstormSectionCollapsed, setIsBrainstormSectionCollapsed] = useState(true);
  const [isSessionPlansSectionCollapsed, setIsSessionPlansSectionCollapsed] = useState(true);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const sessionTitleById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const session of sessions) {
      map.set(session.id, session.title);
    }
    return map;
  }, [sessions]);
  const isAgentThinking = useMemo(
    () => isSending || toolActivityPhase === "thinking" || toolActivityPhase === "tools",
    [isSending, toolActivityPhase],
  );
  const toolActivitySummary = useMemo(() => {
    const failedCount = toolRuns.filter((tool) => tool.status === "failed").length;
    if (toolActivityPhase === "thinking") {
      return "Thinking...";
    }
    if (toolActivityPhase === "tools") {
      return agentState;
    }
    if (toolActivityPhase === "completed") {
      return failedCount > 0 ? "Completed with issues" : "Completed";
    }
    if (toolActivityPhase === "failed") {
      return "Failed";
    }
    return "Idle";
  }, [agentState, toolActivityPhase, toolRuns]);

  const refreshPlans = async (sessionId: string, showLoading = false) => {
    if (!isValidPersistedSessionId(sessionId)) {
      setPlans([]);
      setLoadingPlans(false);
      return;
    }
    if (showLoading) {
      setLoadingPlans(true);
    }
    try {
      const response = await listPlans({ conversationId: sessionId });
      setPlans(response.items);
    } catch (error) {
      setErrorMessage(parseErrorMessage(error, "Failed to load plans."));
    } finally {
      if (showLoading) {
        setLoadingPlans(false);
      }
    }
  };

  const refreshIdeaPlans = async (targetUserId: string, showLoading = false) => {
    if (!targetUserId) {
      setIdeaPlans([]);
      return;
    }
    if (showLoading) {
      setLoadingIdeaPlans(true);
    }
    try {
      const response = await listPlans({ userId: targetUserId });
      setIdeaPlans(response.items);
    } catch (error) {
      setErrorMessage(parseErrorMessage(error, "Failed to load brainstorming ideas."));
    } finally {
      if (showLoading) {
        setLoadingIdeaPlans(false);
      }
    }
  };

  const refreshContentItems = async (
    sessionId: string,
    showLoading = false,
    options?: { selectNewest?: boolean },
  ) => {
    if (!sessionId || !isValidPersistedSessionId(sessionId)) {
      setContentItems([]);
      setSelectedContentId(null);
      setLoadingContentItems(false);
      return;
    }
    if (showLoading) {
      setLoadingContentItems(true);
    }
    try {
      const response = await listContentItems({ conversationId: sessionId });
      setContentItems(response.items);
      setSelectedContentId((current) => {
        if (options?.selectNewest) {
          return response.items[0]?.id ?? null;
        }
        if (current && response.items.some((item) => item.id === current)) {
          return current;
        }
        return response.items[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(parseErrorMessage(error, "Failed to load content drafts."));
    } finally {
      if (showLoading) {
        setLoadingContentItems(false);
      }
    }
  };

  const loadSessionArtifacts = async (sessionId: string, showLoading = false) => {
    if (!sessionId || !isValidPersistedSessionId(sessionId)) {
      setMessages([]);
      setPlans([]);
      setContentItems([]);
      setSelectedContentId(null);
      setLoadingMessages(false);
      setLoadingPlans(false);
      setLoadingContentItems(false);
      return;
    }

    if (showLoading) {
      setLoadingMessages(true);
      setLoadingPlans(true);
      setLoadingContentItems(true);
    }

    try {
      const [messageResponse, planResponse, contentResponse] = await Promise.all([
        listSessionMessages(sessionId),
        listPlans({ conversationId: sessionId }),
        listContentItems({ conversationId: sessionId }),
      ]);

      setMessages(messageResponse.items);
      setPlans(planResponse.items);
      setContentItems(contentResponse.items);
      setSelectedContentId((current) => {
        if (current && contentResponse.items.some((item) => item.id === current)) {
          return current;
        }
        return contentResponse.items[0]?.id ?? null;
      });
    } catch (error) {
      setMessages([]);
      setPlans([]);
      setContentItems([]);
      setSelectedContentId(null);
      setErrorMessage(parseErrorMessage(error, "Failed to load workspace data."));
    } finally {
      if (showLoading) {
        setLoadingMessages(false);
        setLoadingPlans(false);
        setLoadingContentItems(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      setLoadingSessions(true);
      setErrorMessage(null);
      try {
        const savedUserId = localStorage.getItem(USER_ID_STORAGE_KEY) ?? "";

        if (savedUserId) {
          try {
            const [savedUserContext, sessionResponse] = await Promise.all([
              getUserContext(savedUserId),
              listSessions({ userId: savedUserId }),
            ]);

            if (!isMounted) {
              return;
            }

            setUserContext(savedUserContext);
            setUserId(savedUserContext.id);
            setIsOnboardingOpen(false);

            const loadedSessions = sessionResponse.items;
            setSessions(loadedSessions);
            setActiveSessionId(pickInitialActiveSessionId(loadedSessions));
            return;
          } catch {
            if (!isMounted) {
              return;
            }
            localStorage.removeItem(USER_ID_STORAGE_KEY);
            setUserId("");
            setUserContext(null);
            setSessions([]);
            setActiveSessionId(null);
          }
        }

        const sessionResponse = await listSessions();
        if (!isMounted) {
          return;
        }

        const loadedSessions = sessionResponse.items;
        const derivedUserId = loadedSessions[0]?.user_id ?? "";

        if (!derivedUserId) {
          setSessions([]);
          setUserId("");
          setUserContext(null);
          setActiveSessionId(null);
          setIsOnboardingOpen(true);
          return;
        }

        try {
          const derivedUserContext = await getUserContext(derivedUserId);
          if (!isMounted) {
            return;
          }

          setUserContext(derivedUserContext);
          setUserId(derivedUserContext.id);
          setIsOnboardingOpen(false);

          const scopedSessions = loadedSessions.filter((session) => session.user_id === derivedUserContext.id);
          setSessions(scopedSessions);
          setActiveSessionId(pickInitialActiveSessionId(scopedSessions));
        } catch (contextError) {
          if (!isMounted) {
            return;
          }
          setSessions([]);
          setUserId("");
          setUserContext(null);
          setActiveSessionId(null);
          setIsOnboardingOpen(true);
          setErrorMessage(parseErrorMessage(contextError, "Failed to restore user context."));
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setErrorMessage(parseErrorMessage(error, "Failed to load sessions."));
      } finally {
        if (isMounted) {
          setLoadingSessions(false);
        }
      }
    };

    void bootstrap();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userId.trim()) {
      localStorage.removeItem(USER_ID_STORAGE_KEY);
      return;
    }
    localStorage.setItem(USER_ID_STORAGE_KEY, userId.trim());
  }, [userId]);

  useEffect(() => {
    const currentUserId = userContext?.id ?? "";
    if (!currentUserId) {
      setIdeaPlans([]);
      setLoadingIdeaPlans(false);
      return;
    }
    void refreshIdeaPlans(currentUserId, true);
  }, [userContext?.id]);

  useEffect(() => {
    if (!activeSessionId || !isValidPersistedSessionId(activeSessionId)) {
      localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || !isValidPersistedSessionId(activeSessionId)) {
      setMessages([]);
      setPlans([]);
      setContentItems([]);
      setSelectedContentId(null);
      setExecutingPlanId(null);
      setRegeneratingContentId(null);
      setSavingContentId(null);
      setToolRuns([]);
      setExpectedToolCount(0);
      setToolActivityPhase("idle");
      setAgentState("Idle");
      setLoadingMessages(false);
      setLoadingPlans(false);
      setLoadingContentItems(false);
      return;
    }

    setToolRuns([]);
    setExpectedToolCount(0);
    setToolActivityPhase("idle");
    setAgentState("Idle");
    void loadSessionArtifacts(activeSessionId, true);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || !isValidPersistedSessionId(activeSessionId)) {
      setStreamStatus("disconnected");
      setStreamNotice(activeSessionId && isTemporarySessionId(activeSessionId) ? "Creating session..." : null);
      needsStreamResyncRef.current = false;
      return;
    }
    setStreamStatus("connecting");
    setStreamNotice(null);

    const { disconnect } = connectLiveStream((incomingEvent) => {
      if (incomingEvent.event === "stream.connected" || incomingEvent.event === "connected") {
        setStreamStatus("connected");
        setStreamNotice(null);
        if (needsStreamResyncRef.current) {
          needsStreamResyncRef.current = false;
          void loadSessionArtifacts(activeSessionId);
          if (userContext?.id) {
            void refreshIdeaPlans(userContext.id);
          }
        }
        return;
      }

      if (incomingEvent.event === "stream.reconnecting") {
        setStreamStatus("reconnecting");
        setStreamNotice("Live updates interrupted. Reconnecting...");
        needsStreamResyncRef.current = true;
        return;
      }

      if (incomingEvent.event === "stream.disconnected") {
        setStreamStatus("disconnected");
        setStreamNotice("Live updates are disconnected. The app will keep trying to reconnect.");
        needsStreamResyncRef.current = true;
        return;
      }

      if (incomingEvent.event === "message.created") {
        const incomingMessage = asMessageDto(incomingEvent.data);
        if (incomingMessage && incomingMessage.conversation_id === activeSessionId) {
          setMessages((previous) => {
            const reconciled =
              incomingMessage.role === "user"
                ? previous.filter((message) => !isMatchingOptimisticUserMessage(message, incomingMessage))
                : previous;
            return mergeMessages(reconciled, [incomingMessage]);
          });
          if (incomingMessage.role === "assistant") {
            void refreshPlans(activeSessionId);
            void refreshContentItems(activeSessionId);
            if (userContext?.id) {
              void refreshIdeaPlans(userContext.id);
            }
          }
        }
        return;
      }

      if (incomingEvent.event === "agent.response.started") {
        setAgentState("Thinking...");
        setToolActivityPhase("thinking");
        setToolRuns([]);
        setExpectedToolCount(0);
        return;
      }

      if (incomingEvent.event === "agent.tools.detected") {
        const data = asRecord(incomingEvent.data);
        const count = typeof data?.count === "number" ? data.count : 0;
        setToolActivityPhase("tools");
        setExpectedToolCount(count);
        setAgentState(count > 0 ? `Running ${count} tool${count > 1 ? "s" : ""}...` : "Running tools...");
        return;
      }

      if (incomingEvent.event === "agent.tool.started") {
        const data = asRecord(incomingEvent.data);
        const toolName = typeof data?.tool_name === "string" ? data.tool_name : "unknown";
        const activityMessage = getToolActivityMessage(data);
        const toolUseId =
          typeof data?.tool_use_id === "string" ? data.tool_use_id : `${toolName}-${String(Date.now())}`;
        const iteration = typeof data?.iteration === "number" ? data.iteration : 1;
        setToolActivityPhase("tools");
        setToolRuns((previous) =>
          upsertToolRun(previous, {
            toolUseId,
            toolName,
            iteration,
            status: "running",
            details: activityMessage,
          }),
        );
        setAgentState(activityMessage ?? `Running tool: ${toolName}`);
        return;
      }

      if (incomingEvent.event === "agent.tool.completed") {
        const data = asRecord(incomingEvent.data);
        const toolName = typeof data?.tool_name === "string" ? data.tool_name : "unknown";
        const activityMessage = getToolActivityMessage(data);
        const toolUseId =
          typeof data?.tool_use_id === "string" ? data.tool_use_id : `${toolName}-${String(Date.now())}`;
        const iteration = typeof data?.iteration === "number" ? data.iteration : 1;
        setToolRuns((previous) =>
          upsertToolRun(previous, {
            toolUseId,
            toolName,
            iteration,
            status: "completed",
            details: activityMessage,
          }),
        );
        setAgentState(activityMessage ?? `Tool completed: ${toolName}`);
        if (toolName === "create_content_idea" && userContext?.id) {
          void refreshPlans(activeSessionId);
          void refreshIdeaPlans(userContext.id);
        }
        if (toolName === "execute_plan") {
          setActiveTab("content");
          setExecutingPlanId(null);
          setRegeneratingContentId(null);
          void refreshPlans(activeSessionId);
          void refreshContentItems(activeSessionId, false, { selectNewest: true });
        }
        return;
      }

      if (incomingEvent.event === "agent.tool.failed") {
        const data = asRecord(incomingEvent.data);
        const toolName = typeof data?.tool_name === "string" ? data.tool_name : "unknown";
        const error = typeof data?.error === "string" ? data.error : "Tool failed.";
        const activityMessage = getToolActivityMessage(data);
        const toolUseId =
          typeof data?.tool_use_id === "string" ? data.tool_use_id : `${toolName}-${String(Date.now())}`;
        const iteration = typeof data?.iteration === "number" ? data.iteration : 1;
        setToolActivityPhase("failed");
        setToolRuns((previous) =>
          upsertToolRun(previous, {
            toolUseId,
            toolName,
            iteration,
            status: "failed",
            details: activityMessage,
            error,
          }),
        );
        setAgentState(activityMessage ?? `Tool failed: ${toolName}`);
        return;
      }

      if (incomingEvent.event === "agent.response.completed") {
        setToolActivityPhase((previous) => {
          if (previous === "failed") {
            return "failed";
          }
          if (previous === "tools") {
            return "completed";
          }
          return "idle";
        });
        setAgentState("Idle");
        return;
      }

      if (incomingEvent.event === "agent.response.retrying") {
        const data = asRecord(incomingEvent.data);
        const attempt = typeof data?.attempt === "number" ? data.attempt : 1;
        const maxAttempts = typeof data?.max_attempts === "number" ? data.max_attempts : attempt;
        setToolActivityPhase("thinking");
        setAgentState(`Retrying AI call (${attempt + 1}/${maxAttempts})...`);
        return;
      }

      if (incomingEvent.event === "agent.response.failed") {
        const data = asRecord(incomingEvent.data);
        const eventError = typeof data?.error === "string" ? data.error : "Agent request failed.";
        setErrorMessage(eventError);
        setToolActivityPhase("failed");
        setAgentState("Failed");
        setExecutingPlanId(null);
        setRegeneratingContentId(null);
      }
    }, activeSessionId);

    return () => disconnect();
  }, [activeSessionId, userContext?.id]);

  const handleSaveOnboarding = async (values: OnboardingFormValues) => {
    setErrorMessage(null);
    setIsSavingOnboarding(true);

    try {
      const context = await upsertUserOnboarding({
        user_id: userContext?.id,
        user_name: values.userName.trim(),
        company_name: values.companyName.trim() || null,
        industry: values.industry.trim() || null,
        target_audience: values.targetAudience.trim() || null,
        brand_voice: values.brandVoice.trim() || null,
        additional_context: values.additionalContext.trim() || null,
      });

      setUserContext(context);
      setUserId(context.id);
      setIsOnboardingOpen(false);

      const sessionResponse = await listSessions({ userId: context.id });
      setSessions(sessionResponse.items);
      setActiveSessionId(pickInitialActiveSessionId(sessionResponse.items));
    } catch (error) {
      setErrorMessage(parseErrorMessage(error, "Failed to save user context."));
    } finally {
      setIsSavingOnboarding(false);
    }
  };

  const handleCreateSession = async (title: string) => {
    const trimmedUserId = userContext?.id ?? userId.trim();
    if (!trimmedUserId) {
      setErrorMessage("Complete onboarding before creating a session.");
      return;
    }

    setErrorMessage(null);
    setIsCreatingSession(true);
    const previousActiveSessionId = activeSessionId;
    const tempSessionId = `temp-session-${Date.now()}`;
    const optimisticSession: SessionDto = {
      id: tempSessionId,
      user_id: trimmedUserId,
      title: title || null,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      setSessions((previous) => [optimisticSession, ...previous]);
      setActiveTab("plan");

      const session = await createSession({
        user_id: trimmedUserId,
        title: title || null,
        status: "active",
      });
      setSessions((previous) =>
        [session, ...previous.filter((item) => item.id !== session.id && item.id !== tempSessionId)],
      );
      setActiveSessionId(session.id);
    } catch (error) {
      setSessions((previous) => previous.filter((item) => item.id !== tempSessionId));
      setActiveSessionId((current) => (current === tempSessionId ? previousActiveSessionId : current));
      setErrorMessage(parseErrorMessage(error, "Failed to create session."));
    } finally {
      setIsCreatingSession(false);
    }
  };

  const sendMessageToAgent = async (
    content: string,
    options?: {
      switchToContentOnSuccess?: boolean;
      preferredPlanId?: string;
      selectNewestContentOnSuccess?: boolean;
    },
  ) => {
    if (!activeSessionId || !isValidPersistedSessionId(activeSessionId)) {
      setErrorMessage("Session is still being created. Please wait a moment and retry.");
      return;
    }

    setErrorMessage(null);
    setIsSending(true);
    setAgentState("Thinking...");
    setToolActivityPhase("thinking");
    setToolRuns([]);
    setExpectedToolCount(0);

    const optimisticMessage: MessageDto = {
      id: `local-${Date.now()}`,
      conversation_id: activeSessionId,
      role: "user",
      content,
      tool_calls: null,
      tool_results: null,
      context_used: null,
      created_at: new Date().toISOString(),
    };
    setMessages((previous) => mergeMessages(previous, [optimisticMessage]));

    try {
      const response = await sendAgentChat({
        conversation_id: activeSessionId,
        content,
        preferred_plan_id: options?.preferredPlanId,
      });

      setMessages((previous) => {
        const withoutOptimistic = previous.filter((message) => message.id !== optimisticMessage.id);
        return mergeMessages(withoutOptimistic, [response.user_message, response.assistant_message]);
      });
      await refreshPlans(activeSessionId);
      await refreshContentItems(activeSessionId, false, {
        selectNewest: options?.selectNewestContentOnSuccess,
      });
      if (userContext?.id) {
        await refreshIdeaPlans(userContext.id);
      }
      if (options?.switchToContentOnSuccess) {
        setActiveTab("content");
      }
      setAgentState("Idle");
    } catch (error) {
      setMessages((previous) => previous.filter((message) => message.id !== optimisticMessage.id));
      setToolActivityPhase("failed");
      setAgentState("Failed");
      setErrorMessage(parseErrorMessage(error, "Failed to send message."));
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (content: string) => {
    try {
      await sendMessageToAgent(content);
    } catch {
      // Error state is already handled in sendMessageToAgent.
    }
  };

  const handleExecutePlan = async (plan: PlanDto) => {
    setExecutingPlanId(plan.id);
    try {
      await sendMessageToAgent(
        buildExecutePlanRequestMessage({
          planTitle: plan.title,
          researchNotes: plan.research_notes,
        }),
        {
          switchToContentOnSuccess: true,
          preferredPlanId: plan.id,
          selectNewestContentOnSuccess: true,
        },
      );
    } finally {
      setExecutingPlanId((current) => (current === plan.id ? null : current));
    }
  };

  const handleSaveContent = async (contentItemId: string, payload: ContentUpdateRequest) => {
    const existingItem = contentItems.find((item) => item.id === contentItemId);
    if (!existingItem) {
      throw new Error("Content item no longer exists.");
    }

    const optimisticTitle = payload.title ?? existingItem.title;
    const optimisticContent = payload.content ?? existingItem.content;
    const contentChanged = payload.content !== undefined && payload.content !== existingItem.content;
    const titleChanged = payload.title !== undefined && payload.title !== existingItem.title;
    const optimisticItem: ContentItemDto = {
      ...existingItem,
      title: optimisticTitle,
      content: optimisticContent,
      meta_description: payload.meta_description !== undefined ? payload.meta_description : existingItem.meta_description,
      tags: payload.tags !== undefined ? payload.tags : existingItem.tags,
      status: payload.status ?? existingItem.status,
      word_count: contentChanged ? countWords(optimisticContent) : existingItem.word_count,
      version: contentChanged || titleChanged ? existingItem.version + 1 : existingItem.version,
      updated_at: new Date().toISOString(),
    };

    setSavingContentId(contentItemId);
    try {
      setContentItems((previous) => previous.map((item) => (item.id === contentItemId ? optimisticItem : item)));
      const updated = await updateContentItem(contentItemId, payload);
      setContentItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setContentItems((previous) => previous.map((item) => (item.id === contentItemId ? existingItem : item)));
      throw error;
    } finally {
      setSavingContentId((current) => (current === contentItemId ? null : current));
    }
  };

  const handleRegenerateContent = async (contentItemId: string, writingInstructions: string | null) => {
    const item = contentItems.find((candidate) => candidate.id === contentItemId);
    if (!item) {
      throw new Error("Content item not found in current session.");
    }
    const sourcePlan = plans.find((plan) => plan.id === item.content_plan_id);
    if (!sourcePlan) {
      throw new Error("Associated plan not found for this content item.");
    }
    setRegeneratingContentId(contentItemId);
    try {
      await sendMessageToAgent(
        buildExecutePlanRequestMessage({
          planTitle: sourcePlan.title,
          researchNotes: sourcePlan.research_notes,
          writingInstructions,
        }),
        {
          switchToContentOnSuccess: true,
          preferredPlanId: sourcePlan.id,
          selectNewestContentOnSuccess: true,
        },
      );
    } finally {
      setRegeneratingContentId((current) => (current === contentItemId ? null : current));
    }
  };

  const handleSavePlan = async (planId: string, payload: PlanUpdateRequest) => {
    const existingPlan = plans.find((plan) => plan.id === planId) ?? ideaPlans.find((plan) => plan.id === planId);
    if (!existingPlan) {
      throw new Error("Plan no longer exists.");
    }

    const optimisticPlan: PlanDto = {
      ...existingPlan,
      title: payload.title ?? existingPlan.title,
      description: payload.description !== undefined ? payload.description : existingPlan.description,
      target_keywords: payload.target_keywords !== undefined ? payload.target_keywords : existingPlan.target_keywords,
      outline: payload.outline ?? existingPlan.outline,
      research_notes: payload.research_notes !== undefined ? payload.research_notes : existingPlan.research_notes,
      status: payload.status ?? existingPlan.status,
      updated_at: new Date().toISOString(),
    };

    setSavingPlanId(planId);
    try {
      setPlans((previous) => upsertPlanById(previous, optimisticPlan));
      setIdeaPlans((previous) => upsertPlanById(previous, optimisticPlan));

      const updated = await updatePlan(planId, payload);
      setPlans((previous) => upsertPlanById(previous, updated));
      setIdeaPlans((previous) => upsertPlanById(previous, updated));
    } catch (error) {
      setPlans((previous) => upsertPlanById(previous, existingPlan));
      setIdeaPlans((previous) => upsertPlanById(previous, existingPlan));
      throw error;
    } finally {
      setSavingPlanId(null);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    const planIndex = plans.findIndex((plan) => plan.id === planId);
    const planToRestore = planIndex >= 0 ? plans[planIndex] : null;
    const ideaIndex = ideaPlans.findIndex((plan) => plan.id === planId);
    const ideaPlanToRestore = ideaIndex >= 0 ? ideaPlans[ideaIndex] : planToRestore;

    setDeletingPlanId(planId);
    try {
      setPlans((previous) => previous.filter((plan) => plan.id !== planId));
      setIdeaPlans((previous) => previous.filter((plan) => plan.id !== planId));
      await deletePlan(planId);
    } catch (error) {
      if (planToRestore) {
        setPlans((previous) => reinsertPlanAtIndex(previous, planToRestore, planIndex));
      }
      if (ideaPlanToRestore) {
        setIdeaPlans((previous) => reinsertPlanAtIndex(previous, ideaPlanToRestore, ideaIndex));
      }
      throw error;
    } finally {
      setDeletingPlanId(null);
    }
  };

  const handleStartSessionFromIdea = async (plan: PlanDto) => {
    if (!userContext?.id) {
      setErrorMessage("Complete onboarding before starting a session from an idea.");
      return;
    }

    setErrorMessage(null);
    setStartingSessionPlanId(plan.id);
    try {
      const response = await startSessionFromPlan(plan.id, {
        title: plan.title,
        status: "active",
      });

      setSessions((previous) => [response.session, ...previous.filter((item) => item.id !== response.session.id)]);
      setActiveSessionId(response.session.id);
      setActiveTab("plan");
      setMessages([]);
      setPlans([response.plan]);
      setContentItems([]);
      setSelectedContentId(null);
      setIdeaPlans((previous) => [response.plan, ...previous.filter((item) => item.id !== response.plan.id)]);
    } catch (error) {
      setErrorMessage(parseErrorMessage(error, "Failed to start a session from this idea."));
    } finally {
      setStartingSessionPlanId(null);
    }
  };

  const handleOpenSessionFromIdea = (sessionId: string) => {
    if (!isValidPersistedSessionId(sessionId)) {
      return;
    }
    setActiveSessionId(sessionId);
    setActiveTab("plan");
  };

  const handleSelectSession = (sessionId: string) => {
    if (!isValidPersistedSessionId(sessionId)) {
      return;
    }
    setActiveSessionId(sessionId);
  };

  const streamBadgeClasses =
    streamStatus === "connected"
      ? "bg-emerald-500/20 text-emerald-200"
      : streamStatus === "reconnecting"
        ? "bg-amber-500/20 text-amber-200"
        : streamStatus === "disconnected"
          ? "bg-rose-500/20 text-rose-200"
          : "bg-slate-500/20 text-slate-200";
  const shellGridClass = isSessionsCollapsed ? "xl:grid-cols-[68px_minmax(0,1fr)]" : "xl:grid-cols-[264px_minmax(0,1fr)]";
  const workspaceGridClass = isWorkspaceCollapsed
    ? "xl:grid-cols-[minmax(0,1fr)]"
    : "xl:grid-cols-[minmax(0,1fr)_var(--workspace-width)]";
  const clampWorkspaceWidth = (nextWidth: number): number => {
    const shellWidth = shellRef.current?.clientWidth ?? window.innerWidth;
    const sessionsWidth = isSessionsCollapsed ? 68 : 264;
    const maxWorkspaceWidth = Math.max(MIN_WORKSPACE_WIDTH, shellWidth - sessionsWidth - MIN_CHAT_WIDTH);
    return Math.min(Math.max(nextWidth, MIN_WORKSPACE_WIDTH), maxWorkspaceWidth);
  };
  const clampedWorkspaceWidth = clampWorkspaceWidth(workspaceWidth);
  const shouldShowHideWorkspaceButton = clampedWorkspaceWidth >= HIDE_WORKSPACE_BUTTON_MIN_WIDTH;
  const workspaceGridStyle: CSSProperties | undefined = isWorkspaceCollapsed
    ? undefined
    : ({
        ["--workspace-width" as string]: `${clampedWorkspaceWidth}px`,
      } as CSSProperties);
  const handleWorkspaceResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workspaceWidth;
    setIsResizingWorkspace(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      setWorkspaceWidth(clampWorkspaceWidth(startWidth + delta));
    };

    const handleMouseUp = () => {
      setIsResizingWorkspace(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  useEffect(() => {
    if (isWorkspaceCollapsed) {
      return;
    }
    const handleResize = () => {
      setWorkspaceWidth((current) => clampWorkspaceWidth(current));
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isWorkspaceCollapsed, isSessionsCollapsed]);

  return (
    <main
      className={`min-h-screen text-[var(--text-primary)] xl:h-screen xl:overflow-hidden ${
        isResizingWorkspace ? "select-none cursor-col-resize" : ""
      }`}
    >
      <div ref={shellRef} className={`mx-auto grid min-h-screen max-w-[1920px] grid-cols-1 xl:h-full xl:min-h-0 ${shellGridClass}`}>
        <aside className="bg-black px-3 py-4 sm:px-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col">
          {isSessionsCollapsed ? (
            <div className="flex h-full min-h-0 flex-col items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setIsSessionsCollapsed(false)}
                className="rounded-full bg-[#2e3542] px-2 py-1 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
              >
                {">"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>
                <button
                  type="button"
                  onClick={() => setIsSessionsCollapsed(true)}
                  className="rounded-full bg-[#2e3542] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
                >
                  {"<"}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${streamBadgeClasses}`}>{streamStatus}</span>
                <span className="rounded-full bg-[#2f3644] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                  {agentState}
                </span>
              </div>
              {streamNotice ? <p className="mt-2 text-xs text-[var(--text-tertiary)]">{streamNotice}</p> : null}
              <div className="mt-3 border-t border-[#2e3440]" />

              <div className="mt-4 px-1 text-xs text-[var(--text-secondary)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-[var(--text-primary)]">Writer Profile</p>
                  <button
                    type="button"
                    onClick={() => setIsOnboardingOpen(true)}
                    className="rounded-full bg-[#2e3542] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
                  >
                    {userContext ? "Edit" : "Setup"}
                  </button>
                </div>
                <p className="mt-1 truncate">{userContext?.user_name ?? "Not configured"}</p>
                <p className="truncate text-[var(--text-tertiary)]">{userContext?.profile.company_name ?? "No company yet"}</p>
              </div>
              <div className="mt-3 border-t border-[#2e3440]" />

              <div className="mt-2">
                <SessionCreateForm onCreate={handleCreateSession} loading={isCreatingSession} disabled={!userContext} />
              </div>

              <div className="mt-3 max-h-[40vh] overflow-y-auto pr-1 sm:max-h-[46vh] xl:max-h-none xl:min-h-0 xl:flex-1">
                {loadingSessions ? (
                  <div className="flex items-center justify-center py-10">
                    <LoadingSkeleton />
                  </div>
                ) : (
                  <SessionList sessions={sessions} activeSessionId={activeSessionId} onSelectSession={handleSelectSession} />
                )}
              </div>
            </>
          )}
        </aside>

        <section className="flex min-h-screen flex-col bg-[#181818] xl:h-full xl:min-h-0 xl:overflow-hidden">
          {isWorkspaceCollapsed ? (
            <div className="flex items-center justify-end px-3 pt-3 sm:px-5">
              <button
                type="button"
                onClick={() => setIsWorkspaceCollapsed(false)}
                className="rounded-full bg-[#2e3542] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
              >
                Show workspace
              </button>
            </div>
          ) : null}
          {errorMessage && <p className="mx-3 mt-4 rounded-xl bg-[#3d2430] px-3 py-2 text-sm text-rose-200 sm:mx-5">{errorMessage}</p>}

          {!activeSession ? (
            <div className="mt-4 px-3 py-8 text-sm text-[var(--text-secondary)] sm:px-5">
              No active session. Create one from the left sidebar.
            </div>
          ) : (
            <div style={workspaceGridStyle} className={`mt-2 grid min-h-0 flex-1 grid-cols-1 gap-0 xl:overflow-hidden ${workspaceGridClass}`}>
              <div className="flex min-h-[72vh] flex-col bg-[#181818] xl:relative xl:min-h-0 xl:overflow-hidden">
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                  <ChatMessageList messages={messages} isThinking={isAgentThinking} />
                  {loadingMessages ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#181818]/78">
                      <LoadingSkeleton />
                    </div>
                  ) : null}
                </div>
                <ToolActivityIndicator
                  phase={toolActivityPhase}
                  summary={toolActivitySummary}
                  expectedToolCount={expectedToolCount}
                  tools={toolRuns}
                />
                <ChatInput onSend={handleSendMessage} disabled={isCreatingSession} loading={isSending} />
                {!isWorkspaceCollapsed ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={handleWorkspaceResizeStart}
                    className={`hidden xl:block absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize ${
                      isResizingWorkspace ? "bg-[#3a4354]" : "bg-transparent hover:bg-[#2e3542]"
                    }`}
                  />
                ) : null}
              </div>

              {!isWorkspaceCollapsed ? (
                <div className="bg-black px-3 pb-3 pt-2 sm:px-5 xl:flex xl:min-h-0 xl:flex-col xl:px-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Dynamic Workspace</p>
                    <div className="flex items-center gap-2">
                      <WorkspaceTabs activeTab={activeTab} onChange={setActiveTab} />
                      {shouldShowHideWorkspaceButton ? (
                        <button
                          type="button"
                          onClick={() => setIsWorkspaceCollapsed(true)}
                          className="rounded-full bg-[#2e3542] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
                        >
                          Hide workspace
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {activeTab === "plan" ? (
                    <div className="mt-3 max-h-[64vh] space-y-4 overflow-y-auto pr-1 xl:max-h-none xl:min-h-0 xl:flex-1">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="rounded-full bg-[#1f2f2a] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                            Brainstorming Workspace
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#1f2f2a] px-2 py-1 text-[11px] font-semibold text-emerald-200">
                              {ideaPlans.length} idea{ideaPlans.length === 1 ? "" : "s"}
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsBrainstormSectionCollapsed((current) => !current)}
                              aria-label={isBrainstormSectionCollapsed ? "Expand brainstorming section" : "Collapse brainstorming section"}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2e3542] text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
                            >
                              {isBrainstormSectionCollapsed ? ">" : "v"}
                            </button>
                          </div>
                        </div>
                        {isBrainstormSectionCollapsed ? null : loadingIdeaPlans ? (
                          <div className="flex items-center justify-center py-8">
                            <LoadingSkeleton />
                          </div>
                        ) : ideaPlans.length === 0 ? (
                          <div className="px-2 py-5 text-sm text-[var(--text-secondary)]">
                            No blog ideas yet. Ask the agent to brainstorm ideas.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {ideaPlans.map((plan) => (
                              <IdeaCard
                                key={plan.id}
                                plan={plan}
                                sessionTitle={sessionTitleById.get(plan.conversation_id) ?? null}
                                isCurrentSession={plan.conversation_id === activeSessionId}
                                starting={startingSessionPlanId === plan.id}
                                onStartSession={handleStartSessionFromIdea}
                                onOpenSession={handleOpenSessionFromIdea}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-[#2e3440] pt-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="rounded-full bg-[#25262f] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-200">
                            Session Plans
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#25262f] px-2 py-1 text-[11px] font-semibold text-sky-200">
                              {plans.length} in this session
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsSessionPlansSectionCollapsed((current) => !current)}
                              aria-label={isSessionPlansSectionCollapsed ? "Expand session plans section" : "Collapse session plans section"}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2e3542] text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[#3a4354]"
                            >
                              {isSessionPlansSectionCollapsed ? ">" : "v"}
                            </button>
                          </div>
                        </div>
                        {isSessionPlansSectionCollapsed ? null : loadingPlans ? (
                          <div className="flex items-center justify-center py-8">
                            <LoadingSkeleton />
                          </div>
                        ) : plans.length === 0 ? (
                          <div className="px-2 py-5 text-sm text-[var(--text-secondary)]">
                            No plans yet. Ask the agent to create one.
                          </div>
                        ) : (
                          plans.map((plan) => (
                            <PlanCard
                              key={plan.id}
                              plan={plan}
                              onSave={handleSavePlan}
                              onDelete={handleDeletePlan}
                              onExecute={handleExecutePlan}
                              saving={savingPlanId === plan.id}
                              deleting={deletingPlanId === plan.id}
                              executing={executingPlanId === plan.id}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                      {loadingContentItems ? (
                        <div className="flex items-center justify-center py-8">
                          <LoadingSkeleton />
                        </div>
                      ) : (
                        <ContentDisplay
                          contentItems={contentItems}
                          selectedContentId={selectedContentId}
                          onSelectContent={setSelectedContentId}
                          onSave={handleSaveContent}
                          onRegenerate={handleRegenerateContent}
                          savingContentId={savingContentId}
                          regeneratingContentId={regeneratingContentId}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
      <OnboardingModal
        open={isOnboardingOpen}
        loading={isSavingOnboarding}
        canDismiss={Boolean(userContext)}
        initialValues={{
          userName: userContext?.user_name ?? "",
          companyName: userContext?.profile.company_name ?? "",
          industry: userContext?.profile.industry ?? "",
          targetAudience: userContext?.profile.target_audience ?? "",
          brandVoice: userContext?.profile.brand_voice ?? "",
          additionalContext: userContext?.profile.additional_context ?? "",
        }}
        onSubmit={handleSaveOnboarding}
        onClose={() => setIsOnboardingOpen(false)}
      />
    </main>
  );
}

