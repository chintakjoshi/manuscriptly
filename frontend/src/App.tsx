import { useEffect, useState } from "react";

import { getHealth } from "./lib/api";

type HealthState = {
  status: "idle" | "loading" | "ok" | "error";
  message: string;
};

export default function App() {
  const [health, setHealth] = useState<HealthState>({
    status: "idle",
    message: "Waiting to check backend health...",
  });

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

  const statusClasses =
    health.status === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : health.status === "error"
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
        </section>
      </div>
    </main>
  );
}
