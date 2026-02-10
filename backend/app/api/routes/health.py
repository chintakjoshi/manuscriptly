from flask import Blueprint, jsonify

health_bp = Blueprint("health", __name__, url_prefix="/api/v1")


@health_bp.get("/health")
def health_check():
    """
    Health check
    ---
    tags:
      - Health
    responses:
      200:
        description: Service is healthy.
        schema:
          $ref: '#/definitions/HealthResponse'
    """
    return jsonify({"status": "ok"}), 200
