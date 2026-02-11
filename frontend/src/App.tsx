import { useEffect, useMemo, useState } from "react";

import { ChatInput } from "./components/chat/ChatInput";
import { ChatMessageList } from "./components/chat/ChatMessageList";
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
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function pickInitialActiveSessionId(sessions: SessionDto[]): string | null {
  const savedActiveSessionId = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  if (savedActiveSessionId && sessions.some((session) => session.id === savedActiveSessionId)) {
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
    error?: string;
  },
): ToolRun[] {
  const index = previous.findIndex((tool) => tool.toolUseId === next.toolUseId);
  const entry: ToolRun = {
    toolUseId: next.toolUseId,
    toolName: next.toolName,
    iteration: next.iteration,
    status: next.status,
    error: next.error,
  };

  if (index === -1) {
    return [...previous, entry];
  }

  const updated = [...previous];
  updated[index] = { ...updated[index], ...entry };
  return updated;
}

function buildExecutePlanRequestMessage(
  params: {
    planId: string;
    planTitle: string;
    researchNotes: string | null;
    writingInstructions?: string | null;
  },
): string {
  const { planId, planTitle, researchNotes, writingInstructions } = params;
  const normalizedNotes = researchNotes?.trim() || "None provided.";
  const instructions = writingInstructions?.trim();
  const lines = [
    "Execute the approved plan and generate the full blog now.",
    `Use execute_plan with this exact plan_id: ${planId}`,
    `Plan title: ${planTitle}`,
    `Research focus: ${normalizedNotes}`,
    "Output format: markdown.",
  ];
  if (instructions) {
    lines.push(`Writing instructions: ${instructions}`);
  }
  return lines.join("\n");
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
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "error">("connecting");
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

  const refreshContentItems = async (sessionId: string, showLoading = false) => {
    if (!sessionId) {
      setContentItems([]);
      setSelectedContentId(null);
      return;
    }
    if (showLoading) {
      setLoadingContentItems(true);
    }
    try {
      const response = await listContentItems({ conversationId: sessionId });
      setContentItems(response.items);
      setSelectedContentId((current) => {
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
    if (!activeSessionId) {
      localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    let isMounted = true;
    if (!activeSessionId) {
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
      return () => {
        isMounted = false;
      };
    }

    const loadArtifacts = async () => {
      setToolRuns([]);
      setExpectedToolCount(0);
      setToolActivityPhase("idle");
      setAgentState("Idle");
      setLoadingMessages(true);
      setLoadingPlans(true);
      setLoadingContentItems(true);
      try {
        const [messageResponse, planResponse, contentResponse] = await Promise.all([
          listSessionMessages(activeSessionId),
          listPlans({ conversationId: activeSessionId }),
          listContentItems({ conversationId: activeSessionId }),
        ]);
        if (!isMounted) {
          return;
        }
        setMessages(messageResponse.items);
        setPlans(planResponse.items);
        setContentItems(contentResponse.items);
        setSelectedContentId(contentResponse.items[0]?.id ?? null);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setMessages([]);
        setPlans([]);
        setContentItems([]);
        setSelectedContentId(null);
        setErrorMessage(parseErrorMessage(error, "Failed to load workspace data."));
      } finally {
        if (isMounted) {
          setLoadingMessages(false);
          setLoadingPlans(false);
          setLoadingContentItems(false);
        }
      }
    };

    void loadArtifacts();
    return () => {
      isMounted = false;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    setStreamStatus("connecting");

    const { eventSource, disconnect } = connectLiveStream((incomingEvent) => {
      if (incomingEvent.event === "stream.error") {
        setStreamStatus("error");
        return;
      }
      setStreamStatus("connected");

      if (incomingEvent.event === "message.created") {
        const incomingMessage = asMessageDto(incomingEvent.data);
        if (incomingMessage && incomingMessage.conversation_id === activeSessionId) {
          setMessages((previous) => mergeMessages(previous, [incomingMessage]));
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
          }),
        );
        setAgentState(`Running tool: ${toolName}`);
        return;
      }

      if (incomingEvent.event === "agent.tool.completed") {
        const data = asRecord(incomingEvent.data);
        const toolName = typeof data?.tool_name === "string" ? data.tool_name : "unknown";
        const toolUseId =
          typeof data?.tool_use_id === "string" ? data.tool_use_id : `${toolName}-${String(Date.now())}`;
        const iteration = typeof data?.iteration === "number" ? data.iteration : 1;
        setToolRuns((previous) =>
          upsertToolRun(previous, {
            toolUseId,
            toolName,
            iteration,
            status: "completed",
          }),
        );
        setAgentState(`Tool completed: ${toolName}`);
        if (toolName === "create_content_idea" && userContext?.id) {
          void refreshPlans(activeSessionId);
          void refreshIdeaPlans(userContext.id);
        }
        if (toolName === "execute_plan") {
          setActiveTab("content");
          setExecutingPlanId(null);
          setRegeneratingContentId(null);
          void refreshPlans(activeSessionId);
          void refreshContentItems(activeSessionId);
        }
        return;
      }

      if (incomingEvent.event === "agent.tool.failed") {
        const data = asRecord(incomingEvent.data);
        const toolName = typeof data?.tool_name === "string" ? data.tool_name : "unknown";
        const error = typeof data?.error === "string" ? data.error : "Tool failed.";
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
            error,
          }),
        );
        setAgentState(`Tool failed: ${toolName}`);
        return;
      }

      if (incomingEvent.event === "agent.response.completed") {
        setToolActivityPhase((previous) => (previous === "failed" ? "failed" : "completed"));
        setAgentState("Idle");
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

    eventSource.onopen = () => setStreamStatus("connected");
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
    try {
      const session = await createSession({
        user_id: trimmedUserId,
        title: title || null,
        status: "active",
      });
      setSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)]);
      setActiveSessionId(session.id);
      setActiveTab("plan");
    } catch (error) {
      setErrorMessage(parseErrorMessage(error, "Failed to create session."));
    } finally {
      setIsCreatingSession(false);
    }
  };

  const sendMessageToAgent = async (content: string, options?: { switchToContentOnSuccess?: boolean }) => {
    if (!activeSessionId) {
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
      });

      setMessages((previous) => {
        const withoutOptimistic = previous.filter((message) => message.id !== optimisticMessage.id);
        return mergeMessages(withoutOptimistic, [response.user_message, response.assistant_message]);
      });
      await refreshPlans(activeSessionId);
      await refreshContentItems(activeSessionId);
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
          planId: plan.id,
          planTitle: plan.title,
          researchNotes: plan.research_notes,
        }),
        { switchToContentOnSuccess: true },
      );
    } finally {
      setExecutingPlanId((current) => (current === plan.id ? null : current));
    }
  };

  const handleSaveContent = async (contentItemId: string, payload: ContentUpdateRequest) => {
    setSavingContentId(contentItemId);
    try {
      const updated = await updateContentItem(contentItemId, payload);
      setContentItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    } finally {
      setSavingContentId((current) => (current === contentItemId ? null : current));
    }
  };

  const handleRegenerateContent = async (contentItemId: string, writingInstructions: string | null) => {
    const item = contentItems.find((candidate) => candidate.id === contentItemId);
    if (!item) {
      throw new Error("Content item not found in current session.");
    }
    setRegeneratingContentId(contentItemId);
    try {
      await sendMessageToAgent(
        buildExecutePlanRequestMessage({
          planId: item.content_plan_id,
          planTitle: item.title,
          researchNotes: item.meta_description,
          writingInstructions,
        }),
        { switchToContentOnSuccess: true },
      );
    } finally {
      setRegeneratingContentId((current) => (current === contentItemId ? null : current));
    }
  };

  const handleSavePlan = async (planId: string, payload: PlanUpdateRequest) => {
    setSavingPlanId(planId);
    try {
      const updated = await updatePlan(planId, payload);
      setPlans((previous) => previous.map((plan) => (plan.id === updated.id ? updated : plan)));
      setIdeaPlans((previous) => previous.map((plan) => (plan.id === updated.id ? updated : plan)));
    } finally {
      setSavingPlanId(null);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    setDeletingPlanId(planId);
    try {
      await deletePlan(planId);
      setPlans((previous) => previous.filter((plan) => plan.id !== planId));
      setIdeaPlans((previous) => previous.filter((plan) => plan.id !== planId));
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
    setActiveSessionId(sessionId);
    setActiveTab("plan");
  };

  const streamBadgeClasses =
    streamStatus === "connected"
      ? "bg-emerald-100 text-emerald-700"
      : streamStatus === "error"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm sm:p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Sessions</h1>
          </div>
          <p className="mt-1 text-xs text-slate-600">Create and switch chat sessions.</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${streamBadgeClasses}`}>{streamStatus}</span>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-700">Writer Profile</p>
              <button
                type="button"
                onClick={() => setIsOnboardingOpen(true)}
                className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                {userContext ? "Edit" : "Setup"}
              </button>
            </div>
            <p className="mt-1 truncate">{userContext?.user_name ?? "Not configured"}</p>
            <p className="truncate text-slate-500">{userContext?.profile.company_name ?? "No company yet"}</p>
          </div>

          <div className="mt-3">
            <SessionCreateForm onCreate={handleCreateSession} loading={isCreatingSession} disabled={!userContext} />
          </div>

          <div className="mt-3 max-h-[52vh] overflow-y-auto pr-1">
            {loadingSessions ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-5 text-xs text-slate-500">
                Loading sessions...
              </div>
            ) : (
              <SessionList sessions={sessions} activeSessionId={activeSessionId} onSelectSession={setActiveSessionId} />
            )}
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Active Session</p>
            <p className="mt-1 truncate">{activeSession?.title ?? "None selected"}</p>
          </div>
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Workspace</h2>
            <span className="rounded-md bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">{agentState}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {activeSession
              ? `Session: ${activeSession.title || "Untitled session"}`
              : "Select or create a session to start chatting."}
          </p>

          {errorMessage && <p className="mt-3 rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>}

          {!activeSession ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              No active session. Create one from the left sidebar.
            </div>
          ) : loadingMessages ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              Loading messages...
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
              <div>
                <ChatMessageList messages={messages} isThinking={isAgentThinking} />
                <ToolActivityIndicator
                  phase={toolActivityPhase}
                  summary={toolActivitySummary}
                  expectedToolCount={expectedToolCount}
                  tools={toolRuns}
                />
                <ChatInput onSend={handleSendMessage} disabled={isCreatingSession} loading={isSending} />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Dynamic Workspace</p>
                  <WorkspaceTabs activeTab={activeTab} onChange={setActiveTab} />
                </div>

                {activeTab === "plan" ? (
                  <div className="mt-3 max-h-[62vh] space-y-4 overflow-y-auto pr-1">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Brainstorming Workspace</p>
                        <span className="text-[11px] text-slate-500">{ideaPlans.length} idea{ideaPlans.length === 1 ? "" : "s"}</span>
                      </div>
                      {loadingIdeaPlans ? (
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-sm text-slate-500">
                          Loading blog ideas...
                        </div>
                      ) : ideaPlans.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-sm text-slate-500">
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

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session Plans</p>
                        <span className="text-[11px] text-slate-500">{plans.length} in this session</span>
                      </div>
                      {loadingPlans ? (
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-sm text-slate-500">
                          Loading plans...
                        </div>
                      ) : plans.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-sm text-slate-500">
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
                  <div className="mt-3">
                    {loadingContentItems ? (
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-sm text-slate-500">
                        Loading content drafts...
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
