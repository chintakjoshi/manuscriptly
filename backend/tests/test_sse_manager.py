from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
