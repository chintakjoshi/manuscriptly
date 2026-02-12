from __future__ import annotations

import threading
from time import perf_counter
import unittest
from uuid import uuid4

from app.core.sse import SSEConnectionManager


class SSEConnectionManagerTests(unittest.TestCase):
    def test_publish_filters_by_session_and_broadcasts(self) -> None:
        manager = SSEConnectionManager()
        session_a = str(uuid4())
        session_b = str(uuid4())

        global_client = manager.connect()
        client_a = manager.connect(session_id=session_a)
        client_b = manager.connect(session_id=session_b)

        # consume initial connected events
        manager.next_event(global_client, timeout_seconds=0.01)
        manager.next_event(client_a, timeout_seconds=0.01)
        manager.next_event(client_b, timeout_seconds=0.01)

        scoped_deliveries = manager.publish("message.created", {"scope": "a"}, session_id=session_a)
        self.assertEqual(scoped_deliveries, 1)
        self.assertIn("event: message.created", manager.next_event(client_a, timeout_seconds=0.01))
        self.assertEqual(manager.next_event(global_client, timeout_seconds=0.01), ": keep-alive\n\n")
        self.assertEqual(manager.next_event(client_b, timeout_seconds=0.01), ": keep-alive\n\n")

        broadcast_deliveries = manager.publish("agent.response.completed", {"scope": "all"})
        self.assertEqual(broadcast_deliveries, 3)
        self.assertIn("event: agent.response.completed", manager.next_event(global_client, timeout_seconds=0.01))
        self.assertIn("event: agent.response.completed", manager.next_event(client_a, timeout_seconds=0.01))
        self.assertIn("event: agent.response.completed", manager.next_event(client_b, timeout_seconds=0.01))

    def test_next_event_returns_keep_alive_when_idle(self) -> None:
        manager = SSEConnectionManager()
        client = manager.connect()
        manager.next_event(client, timeout_seconds=0.01)  # consume connected event
        self.assertEqual(manager.next_event(client, timeout_seconds=0), ": keep-alive\n\n")

    def test_publish_to_many_clients_is_fast_and_complete(self) -> None:
        manager = SSEConnectionManager()
        session_id = str(uuid4())
        clients = [manager.connect(session_id=session_id) for _ in range(120)]
        for client in clients:
            manager.next_event(client, timeout_seconds=0.01)  # consume connected event

        started = perf_counter()
        deliveries = manager.publish("agent.response.completed", {"ok": True}, session_id=session_id)
        elapsed_seconds = perf_counter() - started

        self.assertEqual(deliveries, 120)
        self.assertLess(elapsed_seconds, 0.5)
        for client in clients:
            event = manager.next_event(client, timeout_seconds=0.1)
            self.assertIn("event: agent.response.completed", event)

    def test_concurrent_session_scoped_publish_keeps_event_isolation(self) -> None:
        manager = SSEConnectionManager()
        session_a = str(uuid4())
        session_b = str(uuid4())
        clients_a = [manager.connect(session_id=session_a) for _ in range(25)]
        clients_b = [manager.connect(session_id=session_b) for _ in range(25)]
        for client in [*clients_a, *clients_b]:
            manager.next_event(client, timeout_seconds=0.01)  # consume connected event

        per_session_events = 20
        per_publish_deliveries: list[int] = []

        def publish_many(target_session_id: str, scope: str) -> None:
            for index in range(per_session_events):
                deliveries = manager.publish(
                    "message.created",
                    {"scope": scope, "index": index},
                    session_id=target_session_id,
                )
                per_publish_deliveries.append(deliveries)

        thread_a = threading.Thread(target=publish_many, args=(session_a, "a"))
        thread_b = threading.Thread(target=publish_many, args=(session_b, "b"))
        thread_a.start()
        thread_b.start()
        thread_a.join()
        thread_b.join()

        self.assertEqual(len(per_publish_deliveries), per_session_events * 2)
        self.assertTrue(all(deliveries == 25 for deliveries in per_publish_deliveries))

        for client in clients_a:
            events = [manager.next_event(client, timeout_seconds=0.1) for _ in range(per_session_events)]
            self.assertTrue(all('"scope": "a"' in event for event in events))
            self.assertTrue(all('"scope": "b"' not in event for event in events))

        for client in clients_b:
            events = [manager.next_event(client, timeout_seconds=0.1) for _ in range(per_session_events)]
            self.assertTrue(all('"scope": "b"' in event for event in events))
            self.assertTrue(all('"scope": "a"' not in event for event in events))


if __name__ == "__main__":
    unittest.main()
