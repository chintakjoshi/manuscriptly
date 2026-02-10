import { useEffect, useState } from "react";

import { getHealth, sendStreamTestMessage } from "./lib/api";
import { connectLiveStream, type LiveEvent } from "./lib/sse";

type HealthState = {
  status: "idle" | "loading" | "ok" | "error";
  message: string;
};

export default function App() {
  const [health, setHealth] = useState<HealthState>({
    status: "idle",
    message: "Waiting to check backend health...",
  });
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      setHealth({ status: "loading", message: "Checking backend health..." });

      try {
        const response = await getHealth();

        if (!isMounted) {
          return;
        }

        setHealth({
          status: response.status === "ok" ? "ok" : "error",
          message:
            response.status === "ok"
              ? "Backend health check passed."
              : "Backend returned an unexpected health response.",
        });
      } catch {
        if (!isMounted) {
          return;
        }

        setHealth({
          status: "error",
          message:
            "Backend health check failed. Start Flask backend at http://localhost:8000.",
        });
      }
    };

    void checkHealth();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const { eventSource, disconnect } = connectLiveStream((incomingEvent) => {
      setLiveEvents((previous) => [incomingEvent, ...previous].slice(0, 10));
      if (incomingEvent.event === "stream.error") {
        setStreamStatus("error");
      } else {
        setStreamStatus("connected");
      }
    });

    eventSource.onopen = () => {
      setStreamStatus("connected");
    };

    return () => {
      disconnect();
    };
  }, []);

  const handleSendTestEvent = async () => {
    setSending(true);
    try {
      await sendStreamTestMessage({
        message: "Frontend test event",
      });
    } finally {
      setSending(false);
    }
  };

  const statusClasses =
    health.status === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : health.status === "error"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";
  const streamStatusClasses =
    streamStatus === "connected"
      ? "bg-emerald-100 text-emerald-700"
      : streamStatus === "error"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-[340px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold">Chat Workspace</h1>
          <p className="mt-2 text-sm text-slate-600">
            Phase 1 scaffold: this panel will become the chat interface.
          </p>
          <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            Chat input and streaming responses will be added in later phases.
          </div>
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Dynamic Workspace</h2>
          <p className="mt-2 text-sm text-slate-600">
            Backend connectivity check for the Flask API.
          </p>

          <div className="mt-6 max-w-xl rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-medium text-slate-700">Backend Health</div>
            <p className={`mt-3 inline-flex rounded-md px-3 py-1 text-sm font-medium ${statusClasses}`}>
              {health.message}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Endpoint: <code>GET /api/v1/health</code>
            </p>
          </div>

          <div className="mt-6 max-w-xl rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-medium text-slate-700">Live Stream (SSE)</div>
            <p className={`mt-3 inline-flex rounded-md px-3 py-1 text-sm font-medium ${streamStatusClasses}`}>
              {streamStatus === "connected"
                ? "Connected"
                : streamStatus === "error"
                  ? "Connection error"
                  : "Connecting..."}
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleSendTestEvent()}
                disabled={sending}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {sending ? "Sending..." : "Send Test Event"}
              </button>
            </div>
            <div className="mt-4 rounded-md bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-700">Latest Events</p>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {liveEvents.length === 0 && <li>No events yet.</li>}
                {liveEvents.map((event, index) => (
                  <li key={`${event.receivedAt}-${index}`} className="rounded border border-slate-200 bg-white p-2">
                    <div className="font-medium text-slate-800">{event.event}</div>
                    <div className="mt-1 break-all">{JSON.stringify(event.data)}</div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Endpoints: <code>GET /api/v1/stream</code>, <code>POST /api/v1/stream/test</code>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
