import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(dotenv_path=BACKEND_ROOT / ".env")


class Config:
    APP_NAME = os.getenv("APP_NAME", "manuscriptly-the-writer-backend")
    ENV = os.getenv("FLASK_ENV", "development")
    DEBUG = os.getenv("FLASK_DEBUG", "1") == "1"
    CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")]

    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@localhost:5432/manuscriptly_writer",
    )
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
    ANTHROPIC_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "4000"))
    ANTHROPIC_TEMPERATURE = float(os.getenv("ANTHROPIC_TEMPERATURE", "0.4"))
    ANTHROPIC_MAX_TOOL_ITERATIONS = int(os.getenv("ANTHROPIC_MAX_TOOL_ITERATIONS", "5"))
    ANTHROPIC_RETRY_MAX_ATTEMPTS = int(os.getenv("ANTHROPIC_RETRY_MAX_ATTEMPTS", "3"))
    ANTHROPIC_RETRY_BASE_DELAY_SECONDS = float(os.getenv("ANTHROPIC_RETRY_BASE_DELAY_SECONDS", "0.75"))
    ANTHROPIC_RETRY_MAX_DELAY_SECONDS = float(os.getenv("ANTHROPIC_RETRY_MAX_DELAY_SECONDS", "4.0"))
    WEB_SEARCH_API_URL = os.getenv("WEB_SEARCH_API_URL", "https://api.duckduckgo.com/")
    WEB_SEARCH_TIMEOUT_SECONDS = float(os.getenv("WEB_SEARCH_TIMEOUT_SECONDS", "8.0"))
    WEB_SEARCH_MAX_RESULTS = int(os.getenv("WEB_SEARCH_MAX_RESULTS", "5"))
    WEB_SEARCH_USER_AGENT = os.getenv(
        "WEB_SEARCH_USER_AGENT",
        "manuscriptly-the-writer/1.0 (+http://localhost)",
    )
    AGENT_MEMORY_SESSION_MESSAGE_LIMIT = int(os.getenv("AGENT_MEMORY_SESSION_MESSAGE_LIMIT", "6"))
    AGENT_MEMORY_CROSS_SESSION_MESSAGE_LIMIT = int(os.getenv("AGENT_MEMORY_CROSS_SESSION_MESSAGE_LIMIT", "8"))
    AGENT_MEMORY_PLAN_LIMIT = int(os.getenv("AGENT_MEMORY_PLAN_LIMIT", "5"))
