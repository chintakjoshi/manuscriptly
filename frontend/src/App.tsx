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
import { ContentDisplay, type GeneratedContentItem } from "./components/workspace/ContentDisplay";
import { PlanCard } from "./components/workspace/PlanCard";
import { WorkspaceTabs, type WorkspaceTab } from "./components/workspace/WorkspaceTabs";
import {
  createSession,
  deletePlan,
  getHealth,
  listPlans,
  listSessionMessages,
  listSessions,
  sendAgentChat,
  updatePlan,
  type MessageDto,
  type PlanUpdateRequest,
  type PlanDto,
  type SessionDto,
} from "./lib/api";
import { connectLiveStream } from "./lib/sse";

const ACTIVE_SESSION_STORAGE_KEY = "kaka_writer_active_session_id";
const USER_ID_STORAGE_KEY = "kaka_writer_user_id";

type HealthState = {
  status: "idle" | "loading" | "ok" | "error";
  message: string;
};

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

function extractLatestGeneratedContent(messages: MessageDto[]): GeneratedContentItem | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const toolResults = asRecord(message.tool_results);
    const items = Array.isArray(toolResults?.items) ? toolResults.items : [];

    for (let j = items.length - 1; j >= 0; j -= 1) {
      const item = asRecord(items[j]);
      if (!item || item.name !== "execute_plan") {
        continue;
      }
      const result = asRecord(item.result);
      const contentItem = asRecord(result?.content_item);
      if (!contentItem || typeof contentItem.id !== "string" || typeof contentItem.content !== "string") {
        continue;
      }

      return {
        id: contentItem.id,
        title: typeof contentItem.title === "string" ? contentItem.title : "Generated Content",
        content: contentItem.content,
        word_count: typeof contentItem.word_count === "number" ? contentItem.word_count : null,
        tags: Array.isArray(contentItem.tags) ? (contentItem.tags as string[]) : null,
        meta_description: typeof contentItem.meta_description === "string" ? contentItem.meta_description : null,
        created_at: typeof contentItem.created_at === "string" ? contentItem.created_at : null,
      };
    }
  }
  return null;
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({
    status: "idle",
    message: "Waiting to check backend health...",
  });
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("plan");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [agentState, setAgentState] = useState("Idle");
  const [toolActivityPhase, setToolActivityPhase] = useState<ToolActivityPhase>("idle");
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [expectedToolCount, setExpectedToolCount] = useState(0);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const latestGeneratedContent = useMemo(() => extractLatestGeneratedContent(messages), [messages]);
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

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      setLoadingSessions(true);
      setErrorMessage(null);
      setHealth({ status: "loading", message: "Checking backend health..." });

      try {
        const healthResponse = await getHealth();
        if (!isMounted) {
          return;
        }
        setHealth({
          status: healthResponse.status === "ok" ? "ok" : "error",
          message:
            healthResponse.status === "ok"
              ? "Backend health check passed."
              : "Backend returned an unexpected health response.",
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setHealth({
          status: "error",
          message: "Backend health check failed. Start backend at http://localhost:8000.",
        });
        setErrorMessage(parseErrorMessage(error, "Could not connect to backend."));
        setLoadingSessions(false);
        return;
      }

      try {
        const sessionResponse = await listSessions();
        if (!isMounted) {
          return;
        }

        const loadedSessions = sessionResponse.items;
        setSessions(loadedSessions);

        const savedUserId = localStorage.getItem(USER_ID_STORAGE_KEY) ?? "";
        const derivedUserId = savedUserId || loadedSessions[0]?.user_id || "";
        setUserId(derivedUserId);

        const savedActiveSessionId = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        const selectedActiveSessionId =
          savedActiveSessionId && loadedSessions.some((session) => session.id === savedActiveSessionId)
            ? savedActiveSessionId
            : loadedSessions[0]?.id ?? null;
        setActiveSessionId(selectedActiveSessionId);
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
      setToolRuns([]);
      setExpectedToolCount(0);
      setToolActivityPhase("idle");
      setAgentState("Idle");
      setLoadingMessages(false);
      setLoadingPlans(false);
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
      try {
        const [messageResponse, planResponse] = await Promise.all([
          listSessionMessages(activeSessionId),
          listPlans({ conversationId: activeSessionId }),
        ]);
        if (!isMounted) {
          return;
        }
        setMessages(messageResponse.items);
        setPlans(planResponse.items);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setMessages([]);
        setPlans([]);
        setErrorMessage(parseErrorMessage(error, "Failed to load workspace data."));
      } finally {
        if (isMounted) {
          setLoadingMessages(false);
          setLoadingPlans(false);
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
      }
    }, activeSessionId);

    eventSource.onopen = () => setStreamStatus("connected");
    return () => disconnect();
  }, [activeSessionId]);

  const handleCreateSession = async (title: string) => {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      setErrorMessage("User ID is required to create a session.");
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

  const handleSendMessage = async (content: string) => {
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
      setAgentState("Idle");
    } catch (error) {
      setMessages((previous) => previous.filter((message) => message.id !== optimisticMessage.id));
      setToolActivityPhase("failed");
      setAgentState("Failed");
      setErrorMessage(parseErrorMessage(error, "Failed to send message."));
    } finally {
      setIsSending(false);
    }
  };

  const handleSavePlan = async (planId: string, payload: PlanUpdateRequest) => {
    setSavingPlanId(planId);
    try {
      const updated = await updatePlan(planId, payload);
      setPlans((previous) => previous.map((plan) => (plan.id === updated.id ? updated : plan)));
    } finally {
      setSavingPlanId(null);
    }
  };

  const handleDeletePlan = async (planId: string) => {
    setDeletingPlanId(planId);
    try {
      await deletePlan(planId);
      setPlans((previous) => previous.filter((plan) => plan.id !== planId));
    } finally {
      setDeletingPlanId(null);
    }
  };

  const healthBadgeClasses =
    health.status === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : health.status === "error"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";

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
            <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-600">Step 16</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">Create and switch chat sessions.</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${healthBadgeClasses}`}>{health.status}</span>
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${streamBadgeClasses}`}>{streamStatus}</span>
          </div>

          <div className="mt-3">
            <SessionCreateForm
              userId={userId}
              onUserIdChange={setUserId}
              onCreate={handleCreateSession}
              loading={isCreatingSession}
            />
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
                  <div className="mt-3 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
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
                          saving={savingPlanId === plan.id}
                          deleting={deletingPlanId === plan.id}
                        />
                      ))
                    )}
                  </div>
                ) : (
                  <div className="mt-3">
                    <ContentDisplay contentItem={latestGeneratedContent} />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
