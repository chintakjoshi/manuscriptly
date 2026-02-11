from flask import Flask
from flask_cors import CORS

from app.api.routes import agent_bp, messages_bp, plans_bp, sessions_bp, stream_bp, users_bp
from app.api.swagger import init_swagger
from app.core.bootstrap import seed_default_superuser


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
    seed_default_superuser()

    return app
