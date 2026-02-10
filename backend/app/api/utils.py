from __future__ import annotations

from datetime import datetime
from uuid import UUID

from flask import jsonify
from pydantic import ValidationError


def error_response(message: str, status_code: int):
    return jsonify({"error": message}), status_code


def validation_error_response(exc: ValidationError):
    return (
        jsonify(
            {
                "error": "Validation failed.",
                "details": exc.errors(),
            }
        ),
        400,
    )


def to_json_value(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [to_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: to_json_value(item) for key, item in value.items()}
    return value
