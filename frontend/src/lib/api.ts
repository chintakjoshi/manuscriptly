const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

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

export type PlanUpdateRequest = {
  title?: string;
  description?: string | null;
  target_keywords?: string[] | null;
  outline?: Record<string, unknown>;
  research_notes?: string | null;
  status?: string;
};

export type AgentChatRequest = {
  conversation_id: string;
  content: string;
};

export type AgentChatResponse = {
  user_message: MessageDto;
  assistant_message: MessageDto;
  model: string;
};

export async function listSessions(filters?: { userId?: string }): Promise<SessionListResponse> {
  const url = new URL(`${API_BASE_URL}/api/v1/sessions`);
  if (filters?.userId) {
    url.searchParams.set("user_id", filters.userId);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Sessions request failed with ${response.status}`);
  }
  return (await response.json()) as SessionListResponse;
}

export async function createSession(payload: SessionCreateRequest): Promise<SessionDto> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Session create failed with ${response.status}`);
  }
  return (await response.json()) as SessionDto;
}

export async function upsertUserOnboarding(payload: UserOnboardingRequest): Promise<UserContextDto> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/onboarding`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `User onboarding failed with ${response.status}`);
  }
  return (await response.json()) as UserContextDto;
}

export async function getUserContext(userId: string): Promise<UserContextDto> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `User lookup failed with ${response.status}`);
  }
  return (await response.json()) as UserContextDto;
}

export async function listSessionMessages(sessionId: string): Promise<MessageListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions/${sessionId}/messages`);
  if (!response.ok) {
    throw new Error(`Messages request failed with ${response.status}`);
  }
  return (await response.json()) as MessageListResponse;
}

export async function sendAgentChat(payload: AgentChatRequest): Promise<AgentChatResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Agent chat failed with ${response.status}`);
  }
  return (await response.json()) as AgentChatResponse;
}

export async function listPlans(filters?: { conversationId?: string; userId?: string }): Promise<PlanListResponse> {
  const url = new URL(`${API_BASE_URL}/api/v1/plans`);
  if (filters?.conversationId) {
    url.searchParams.set("conversation_id", filters.conversationId);
  }
  if (filters?.userId) {
    url.searchParams.set("user_id", filters.userId);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Plans request failed with ${response.status}`);
  }
  return (await response.json()) as PlanListResponse;
}

export async function updatePlan(planId: string, payload: PlanUpdateRequest): Promise<PlanDto> {
  const response = await fetch(`${API_BASE_URL}/api/v1/plans/${planId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Plan update failed with ${response.status}`);
  }
  return (await response.json()) as PlanDto;
}

export async function deletePlan(planId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/plans/${planId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Plan delete failed with ${response.status}`);
  }
}
