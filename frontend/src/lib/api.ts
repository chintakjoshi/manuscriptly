const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const REQUEST_TIMEOUT_MS = 20_000;
const TRANSIENT_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ApiRequestError extends Error {
  status: number | null;
  retriable: boolean;

  constructor(message: string, options?: { status?: number | null; retriable?: boolean }) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options?.status ?? null;
    this.retriable = options?.retriable ?? false;
  }
}

export type SessionDto = {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type UserProfileDto = {
  id: string | null;
  user_id: string;
  company_name: string | null;
  industry: string | null;
  target_audience: string | null;
  brand_voice: string | null;
  content_preferences: Record<string, unknown> | null;
  additional_context: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type UserContextDto = {
  id: string;
  user_name: string;
  email: string;
  created_at: string;
  updated_at: string;
  profile: UserProfileDto;
};

export type UserOnboardingRequest = {
  user_id?: string;
  user_name: string;
  company_name?: string | null;
  industry?: string | null;
  target_audience?: string | null;
  brand_voice?: string | null;
  content_preferences?: Record<string, unknown> | null;
  additional_context?: string | null;
};

export type SessionCreateRequest = {
  user_id: string;
  title?: string | null;
  status?: string;
};

export type MessageDto = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | string;
  content: string;
  tool_calls: Record<string, unknown> | null;
  tool_results: Record<string, unknown> | null;
  context_used: Record<string, unknown> | null;
  created_at: string;
};

export type PlanDto = {
  id: string;
  conversation_id: string;
  user_id: string;
  title: string;
  description: string | null;
  target_keywords: string[] | null;
  outline: Record<string, unknown>;
  research_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ContentItemDto = {
  id: string;
  content_plan_id: string;
  conversation_id: string | null;
  user_id: string;
  title: string;
  content: string;
  html_content: string | null;
  markdown_content: string | null;
  meta_description: string | null;
  tags: string[] | null;
  word_count: number | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type SessionListResponse = {
  items: SessionDto[];
  count: number;
};

type MessageListResponse = {
  items: MessageDto[];
  count: number;
};

type PlanListResponse = {
  items: PlanDto[];
  count: number;
};

type ContentListResponse = {
  items: ContentItemDto[];
  count: number;
};

type ApiErrorPayload = {
  error?: string;
};

type RequestOptions = {
  retries?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
};

export type PlanUpdateRequest = {
  title?: string;
  description?: string | null;
  target_keywords?: string[] | null;
  outline?: Record<string, unknown>;
  research_notes?: string | null;
  status?: string;
};

export type ContentUpdateRequest = {
  title?: string;
  content?: string;
  meta_description?: string | null;
  tags?: string[] | null;
  status?: string;
  change_description?: string | null;
};

export type StartSessionFromPlanRequest = {
  title?: string | null;
  status?: string;
};

export type StartSessionFromPlanResponse = {
  session: SessionDto;
  plan: PlanDto;
};

export type AgentChatRequest = {
  conversation_id: string;
  content: string;
  preferred_plan_id?: string;
};

export type AgentChatResponse = {
  user_message: MessageDto;
  assistant_message: MessageDto;
  model: string;
};

function resolveUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${API_BASE_URL}${pathOrUrl}`;
}

function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS_CODES.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function toFriendlyHttpFallback(status: number): string {
  if (status === 401 || status === 403) {
    return "You are not authorized to perform this action.";
  }
  if (status === 404) {
    return "The requested resource was not found.";
  }
  if (status === 429) {
    return "Too many requests right now. Please retry shortly.";
  }
  if (status >= 500) {
    return "The server is temporarily unavailable. Please retry in a moment.";
  }
  return `Request failed with status ${status}.`;
}

async function parseErrorPayload(response: Response): Promise<ApiErrorPayload> {
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return {};
  }
}

function withJsonHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function requestJson<T>(
  pathOrUrl: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const maxRetries = options?.retries ?? (method === "GET" ? 2 : 0);
  const retryBaseDelayMs = options?.retryBaseDelayMs ?? 350;
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const url = resolveUrl(pathOrUrl);
  let lastError: ApiRequestError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await parseErrorPayload(response);
        const retriable = isTransientStatus(response.status);
        const message = payload.error?.trim() || toFriendlyHttpFallback(response.status);
        const error = new ApiRequestError(message, { status: response.status, retriable });
        if (attempt < maxRetries && retriable) {
          const delay = retryBaseDelayMs * (2 ** attempt);
          await sleep(delay);
          continue;
        }
        throw error;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      if (!text) {
        return undefined as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiRequestError("Received an invalid response from the server.", {
          status: response.status,
          retriable: false,
        });
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        lastError = error;
        if (attempt < maxRetries && error.retriable) {
          const delay = retryBaseDelayMs * (2 ** attempt);
          await sleep(delay);
          continue;
        }
        throw error;
      }

      const networkError = new ApiRequestError(
        error instanceof DOMException && error.name === "AbortError"
          ? "The request timed out. Please check your network and retry."
          : "Network error. Check your connection and retry.",
        {
          status: null,
          retriable: true,
        },
      );
      lastError = networkError;
      if (attempt < maxRetries) {
        const delay = retryBaseDelayMs * (2 ** attempt);
        await sleep(delay);
        continue;
      }
      throw networkError;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw (
    lastError ??
    new ApiRequestError("Request failed unexpectedly.", {
      status: null,
      retriable: false,
    })
  );
}

export async function listSessions(filters?: { userId?: string }): Promise<SessionListResponse> {
  const url = new URL("/api/v1/sessions", API_BASE_URL);
  if (filters?.userId) {
    url.searchParams.set("user_id", filters.userId);
  }
  return requestJson<SessionListResponse>(url.toString(), { method: "GET" });
}

export async function createSession(payload: SessionCreateRequest): Promise<SessionDto> {
  return requestJson<SessionDto>(
    "/api/v1/sessions",
    {
      method: "POST",
      headers: withJsonHeaders(),
      body: JSON.stringify(payload),
    },
    { retries: 0 },
  );
}

export async function upsertUserOnboarding(payload: UserOnboardingRequest): Promise<UserContextDto> {
  return requestJson<UserContextDto>(
    "/api/v1/users/onboarding",
    {
      method: "POST",
      headers: withJsonHeaders(),
      body: JSON.stringify(payload),
    },
    { retries: 0 },
  );
}

export async function getUserContext(userId: string): Promise<UserContextDto> {
  return requestJson<UserContextDto>(`/api/v1/users/${userId}`, { method: "GET" });
}

export async function listSessionMessages(sessionId: string): Promise<MessageListResponse> {
  return requestJson<MessageListResponse>(`/api/v1/sessions/${sessionId}/messages`, { method: "GET" });
}

export async function sendAgentChat(payload: AgentChatRequest): Promise<AgentChatResponse> {
  return requestJson<AgentChatResponse>(
    "/api/v1/agent/chat",
    {
      method: "POST",
      headers: withJsonHeaders(),
      body: JSON.stringify(payload),
    },
    { retries: 0, timeoutMs: 90_000 },
  );
}

export async function listPlans(filters?: { conversationId?: string; userId?: string }): Promise<PlanListResponse> {
  const url = new URL("/api/v1/plans", API_BASE_URL);
  if (filters?.conversationId) {
    url.searchParams.set("conversation_id", filters.conversationId);
  }
  if (filters?.userId) {
    url.searchParams.set("user_id", filters.userId);
  }
  return requestJson<PlanListResponse>(url.toString(), { method: "GET" });
}

export async function updatePlan(planId: string, payload: PlanUpdateRequest): Promise<PlanDto> {
  return requestJson<PlanDto>(
    `/api/v1/plans/${planId}`,
    {
      method: "PATCH",
      headers: withJsonHeaders(),
      body: JSON.stringify(payload),
    },
    { retries: 0 },
  );
}

export async function deletePlan(planId: string): Promise<void> {
  await requestJson<{ status: string; id: string }>(
    `/api/v1/plans/${planId}`,
    {
      method: "DELETE",
    },
    { retries: 0 },
  );
}

export async function listContentItems(filters?: {
  conversationId?: string;
  contentPlanId?: string;
  userId?: string;
}): Promise<ContentListResponse> {
  const url = new URL("/api/v1/content", API_BASE_URL);
  if (filters?.conversationId) {
    url.searchParams.set("conversation_id", filters.conversationId);
  }
  if (filters?.contentPlanId) {
    url.searchParams.set("content_plan_id", filters.contentPlanId);
  }
  if (filters?.userId) {
    url.searchParams.set("user_id", filters.userId);
  }
  return requestJson<ContentListResponse>(url.toString(), { method: "GET" });
}

export async function updateContentItem(contentItemId: string, payload: ContentUpdateRequest): Promise<ContentItemDto> {
  return requestJson<ContentItemDto>(
    `/api/v1/content/${contentItemId}`,
    {
      method: "PATCH",
      headers: withJsonHeaders(),
      body: JSON.stringify(payload),
    },
    { retries: 0 },
  );
}

export async function startSessionFromPlan(
  planId: string,
  payload: StartSessionFromPlanRequest = {},
): Promise<StartSessionFromPlanResponse> {
  return requestJson<StartSessionFromPlanResponse>(
    `/api/v1/plans/${planId}/start-session`,
    {
      method: "POST",
      headers: withJsonHeaders(),
      body: JSON.stringify(payload),
    },
    { retries: 0 },
  );
}
