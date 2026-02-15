from flask import Flask
from flask import jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from app.api.routes import agent_bp, content_bp, messages_bp, plans_bp, sessions_bp, stream_bp, users_bp
from app.api.swagger import init_swagger


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object("app.core.config.Config")

    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)
    init_swagger(app)

    app.register_blueprint(sessions_bp)
    app.register_blueprint(plans_bp)
    app.register_blueprint(messages_bp)
    app.register_blueprint(stream_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(content_bp)
    register_error_handlers(app)

    return app


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        return jsonify({"error": exc.description or "Request failed."}), exc.code or 500

    @app.errorhandler(Exception)
    def handle_unexpected_error(exc: Exception):
        app.logger.exception("Unhandled server error", exc_info=exc)
        return jsonify({"error": "Unexpected server error. Please retry."}), 500
