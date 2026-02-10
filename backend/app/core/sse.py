from __future__ import annotations

import json
import queue
import threading
from dataclasses import dataclass
from typing import Any
from uuid import uuid4


@dataclass
class SSEClient:
    connection_id: str
    session_id: str | None
    event_queue: "queue.Queue[str]"


class SSEConnectionManager:
    def __init__(self) -> None:
        self._clients: dict[str, SSEClient] = {}
        self._lock = threading.Lock()

    def connect(self, session_id: str | None = None) -> SSEClient:
        client = SSEClient(
            connection_id=str(uuid4()),
            session_id=session_id,
            event_queue=queue.Queue(),
        )
        with self._lock:
            self._clients[client.connection_id] = client

        client.event_queue.put(
            self._format_event(
                "connected",
                {
                    "connection_id": client.connection_id,
                    "session_id": session_id,
                },
            )
        )
        return client

    def disconnect(self, connection_id: str) -> None:
        with self._lock:
            self._clients.pop(connection_id, None)

    def publish(self, event_name: str, payload: Any, session_id: str | None = None) -> int:
        message = self._format_event(event_name, payload)
        with self._lock:
            clients = list(self._clients.values())

        deliveries = 0
        for client in clients:
            if session_id is not None and client.session_id != session_id:
                continue
            client.event_queue.put(message)
            deliveries += 1
        return deliveries

    def next_event(self, client: SSEClient, timeout_seconds: int = 15) -> str:
        try:
            return client.event_queue.get(timeout=timeout_seconds)
        except queue.Empty:
            return ": keep-alive\n\n"

    @staticmethod
    def _format_event(event_name: str, payload: Any) -> str:
        json_payload = json.dumps(payload, default=str)
        return f"event: {event_name}\ndata: {json_payload}\n\n"


sse_manager = SSEConnectionManager()
