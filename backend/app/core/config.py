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
    NIM_API_KEY = os.getenv("NIM_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))
    NIM_BASE_URL = os.getenv("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1")
    NIM_MODEL = os.getenv("NIM_MODEL", os.getenv("ANTHROPIC_MODEL", "openai/gpt-oss-120b"))
    AI_MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", os.getenv("ANTHROPIC_MAX_TOKENS", "4000")))
    AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", os.getenv("ANTHROPIC_TEMPERATURE", "0.4")))
    AI_MAX_TOOL_ITERATIONS = int(
        os.getenv("AI_MAX_TOOL_ITERATIONS", os.getenv("ANTHROPIC_MAX_TOOL_ITERATIONS", "5"))
    )
    AI_RETRY_MAX_ATTEMPTS = int(
        os.getenv("AI_RETRY_MAX_ATTEMPTS", os.getenv("ANTHROPIC_RETRY_MAX_ATTEMPTS", "3"))
    )
    AI_RETRY_BASE_DELAY_SECONDS = float(
        os.getenv("AI_RETRY_BASE_DELAY_SECONDS", os.getenv("ANTHROPIC_RETRY_BASE_DELAY_SECONDS", "0.75"))
    )
    AI_RETRY_MAX_DELAY_SECONDS = float(
        os.getenv("AI_RETRY_MAX_DELAY_SECONDS", os.getenv("ANTHROPIC_RETRY_MAX_DELAY_SECONDS", "4.0"))
    )

    # Backward-compatible aliases for existing call sites/tests.
    ANTHROPIC_API_KEY = NIM_API_KEY
    ANTHROPIC_MODEL = NIM_MODEL
    ANTHROPIC_MAX_TOKENS = AI_MAX_TOKENS
    ANTHROPIC_TEMPERATURE = AI_TEMPERATURE
    ANTHROPIC_MAX_TOOL_ITERATIONS = AI_MAX_TOOL_ITERATIONS
    ANTHROPIC_RETRY_MAX_ATTEMPTS = AI_RETRY_MAX_ATTEMPTS
    ANTHROPIC_RETRY_BASE_DELAY_SECONDS = AI_RETRY_BASE_DELAY_SECONDS
    ANTHROPIC_RETRY_MAX_DELAY_SECONDS = AI_RETRY_MAX_DELAY_SECONDS
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
