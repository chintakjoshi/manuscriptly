from __future__ import annotations

from app.api.utils import to_json_value
from app.models import Message


def format_message_for_api(message: Message) -> dict:
    return {
        "id": to_json_value(message.id),
        "conversation_id": to_json_value(message.conversation_id),
        "role": message.role,
        "content": message.content,
        "tool_calls": to_json_value(message.tool_calls),
        "tool_results": to_json_value(message.tool_results),
        "context_used": to_json_value(message.context_used),
        "created_at": to_json_value(message.created_at),
    }


def format_message_for_history(message: Message) -> dict:
    # Keep history compact for model input while preserving tool metadata.
    payload: dict = {
        "role": message.role,
        "content": message.content,
    }
    if message.tool_calls is not None:
        payload["tool_calls"] = to_json_value(message.tool_calls)
    if message.tool_results is not None:
        payload["tool_results"] = to_json_value(message.tool_results)
    if message.context_used is not None:
        payload["context_used"] = to_json_value(message.context_used)
    return payload


def format_messages_for_history(messages: list[Message]) -> list[dict]:
    return [format_message_for_history(message) for message in messages]


def format_messages_as_transcript(messages: list[Message]) -> str:
    lines: list[str] = []
    for message in messages:
        speaker = "Assistant" if message.role == "assistant" else "User"
        lines.append(f"{speaker}: {message.content}")
    return "\n".join(lines)
