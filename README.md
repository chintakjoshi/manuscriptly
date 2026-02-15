# manuscriptly-the-writer

Local-first prototype for an agentic blog writing workspace.

## Overview

The app pairs a chat interface with a dynamic workspace:
- Left side: session-based chat with live agent/tool activity.
- Right side: brainstorming plans and generated content drafts.
- Backend agent: tool-calling loop (`create_content_idea`, `update_content_plan`, `execute_plan`, `web_search`).

Highlights:
- Onboarding + user/company context memory.
- Session management and persistent message history.
- Tool-driven planning + execution flow.
- SSE live events for chat and tool execution state.
- Manual plan/content edits and delete flows.
- Markdown preview, syntax highlighting, copy, and export (`.md`, `.txt`).
- Web search tool integration.
- Automated test coverage for golden flow, route behavior, SSE isolation, and end-to-end journey.

## Tech Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Flask + SQLAlchemy + Alembic + Pydantic + Anthropic SDK
- Database: PostgreSQL

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker Desktop (optional, recommended)
- PostgreSQL 16+ (only for local non-Docker workflow)

## Environment Setup

### Backend env

```powershell
cd backend
copy .env.example .env
```

Required for AI replies:
- Set `ANTHROPIC_API_KEY` in `backend/.env`

Key backend env values:
- `DATABASE_URL`
- `CORS_ORIGINS`
- `ANTHROPIC_MODEL`
- `WEB_SEARCH_MAX_RESULTS`

### Frontend env

```powershell
cd frontend
copy .env.example .env
```

Key frontend env values:
- `VITE_API_BASE_URL` (default: `http://localhost:8000`)

## Run with Docker

From repo root:

```powershell
docker compose up -d --build
docker compose ps
```

Services:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/apidocs/`
- OpenAPI JSON: `http://localhost:8000/apispec_1.json`
- Adminer: `http://localhost:8080`
- SSE stream: `http://localhost:8000/api/v1/stream`

Default Postgres credentials:
- user: `postgres`
- password: `postgres`
- database: `manuscriptly_writer`

Stop services:

```powershell
docker compose down
```

Reset DB volume:

```powershell
docker compose down -v
```

## Testing

### Backend tests

```powershell
cd backend
python -m unittest discover -s tests -p "test_*.py"
```

### Frontend build check

```powershell
cd frontend
npm run build
```

## Useful Endpoints

- `POST /api/v1/users/onboarding`
- `GET /api/v1/users/{user_id}`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions`
- `GET /api/v1/sessions/{session_id}/messages`
- `POST /api/v1/agent/chat`
- `GET /api/v1/plans`
- `PATCH /api/v1/plans/{plan_id}`
- `DELETE /api/v1/plans/{plan_id}`
- `GET /api/v1/content`
- `PATCH /api/v1/content/{content_item_id}`
- `GET /api/v1/stream`
- `POST /api/v1/stream/test`

## Project Structure

```text
backend/
  app/
    api/routes/        # Flask route modules
    agent_tools/       # Tool schemas, registry, handlers
    services/          # AI, memory, message, web search services
    core/              # config, bootstrap, SSE manager
    models/            # SQLAlchemy entities
    db/                # DB session factory
  alembic/             # migrations
  tests/               # backend test suite
frontend/
  src/
    components/        # chat, session, workspace UI
    lib/               # API + SSE client helpers
```

## Notes

- This is a local development prototype.
- No production deployment hardening is included.
- The focus is golden-flow reliability, testability, and developer ergonomics.
