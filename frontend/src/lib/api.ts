export type HealthResponse = {
  status: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type StreamTestRequest = {
  message?: string;
  session_id?: string;
};

type StreamTestResponse = {
  status: string;
  deliveries: number;
};

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/health`);

  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}

export async function sendStreamTestMessage(payload: StreamTestRequest): Promise<StreamTestResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/stream/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Stream test request failed with ${response.status}`);
  }

  return (await response.json()) as StreamTestResponse;
}
