const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type LiveEvent = {
  event: string;
  data: unknown;
  receivedAt: string;
};

type StreamListener = (event: LiveEvent) => void;

function parseEventData(rawData: string): unknown {
  try {
    return JSON.parse(rawData) as unknown;
  } catch {
    return rawData;
  }
}

export function connectLiveStream(
  onEvent: StreamListener,
  sessionId?: string,
): { eventSource: EventSource; disconnect: () => void } {
  const streamUrl = new URL("/api/v1/stream", API_BASE_URL);
  if (sessionId) {
    streamUrl.searchParams.set("session_id", sessionId);
  }

  const eventSource = new EventSource(streamUrl.toString());

  const forward = (eventName: string) => (event: MessageEvent<string>) => {
    onEvent({
      event: eventName,
      data: parseEventData(event.data),
      receivedAt: new Date().toISOString(),
    });
  };

  eventSource.addEventListener("connected", forward("connected"));
  eventSource.addEventListener("test.message", forward("test.message"));
  eventSource.addEventListener("message.created", forward("message.created"));
  eventSource.addEventListener("agent.response.started", forward("agent.response.started"));
  eventSource.addEventListener("agent.response.completed", forward("agent.response.completed"));
  eventSource.addEventListener("agent.response.failed", forward("agent.response.failed"));
  eventSource.addEventListener("agent.tools.detected", forward("agent.tools.detected"));
  eventSource.addEventListener("agent.tool.started", forward("agent.tool.started"));
  eventSource.addEventListener("agent.tool.completed", forward("agent.tool.completed"));
  eventSource.addEventListener("agent.tool.failed", forward("agent.tool.failed"));
  eventSource.onerror = () => {
    onEvent({
      event: "stream.error",
      data: "Connection error",
      receivedAt: new Date().toISOString(),
    });
  };

  return {
    eventSource,
    disconnect: () => eventSource.close(),
  };
}
