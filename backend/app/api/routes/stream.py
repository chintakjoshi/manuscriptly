from __future__ import annotations

from flask import Blueprint, Response, jsonify, request, stream_with_context

from app.core.sse import sse_manager

stream_bp = Blueprint("stream", __name__, url_prefix="/api/v1")


@stream_bp.get("/stream")
def stream_events():
    """
    Stream live events (SSE)
    ---
    tags:
      - Stream
    produces:
      - text/event-stream
    parameters:
      - in: query
        name: session_id
        required: false
        type: string
        format: uuid
        description: Optional session scope for targeted updates.
    responses:
      200:
        description: Continuous server-sent events stream.
    """
    session_id = request.args.get("session_id")
    client = sse_manager.connect(session_id=session_id)

    @stream_with_context
    def generate():
        try:
            while True:
                yield sse_manager.next_event(client)
        finally:
            sse_manager.disconnect(client.connection_id)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return Response(generate(), mimetype="text/event-stream", headers=headers)


@stream_bp.post("/stream/test")
def publish_test_event():
    """
    Publish test stream event
    ---
    tags:
      - Stream
    parameters:
      - in: body
        name: body
        required: false
        schema:
          $ref: '#/definitions/StreamTestRequest'
    responses:
      200:
        description: Test event published.
        schema:
          $ref: '#/definitions/StreamTestResponse'
    """
    payload = request.get_json(silent=True) or {}
    message = payload.get("message", "Hello from backend stream")
    session_id = payload.get("session_id")

    deliveries = sse_manager.publish(
        "test.message",
        {"message": message, "session_id": session_id},
        session_id=session_id,
    )
    return jsonify({"status": "sent", "deliveries": deliveries}), 200
