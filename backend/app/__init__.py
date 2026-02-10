from flask import Flask
from flask_cors import CORS

from app.api.routes.health import health_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object("app.core.config.Config")

    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)

    app.register_blueprint(health_bp)

    return app
