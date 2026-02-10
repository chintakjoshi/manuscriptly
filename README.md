# kaka-the-writer

Local prototype for a content-writing agent.

## Docker (PostgreSQL)

```powershell
docker compose up -d postgres
docker compose ps
```

PostgreSQL is exposed at `localhost:5432` with:
- user: `postgres`
- password: `postgres`
- database: `kaka_writer`

## Docker (Full App)

Run backend + frontend + postgres:

```powershell
docker compose up -d --build
docker compose ps
```

Services:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health check: `http://localhost:8000/api/v1/health`
- Swagger UI: `http://localhost:8000/apidocs/`
- OpenAPI JSON: `http://localhost:8000/apispec_1.json`
- Adminer: `http://localhost:8080`
- SSE stream: `http://localhost:8000/api/v1/stream`

Adminer login values:
- System: `PostgreSQL`
- Server: `postgres`
- Username: `postgres`
- Password: `postgres`
- Database: `kaka_writer`

Default superuser (seeded once on first boot when `users` table is empty):
- user name: `admin`
- email: `admin@example.com`
- password: `admin123`

You can override with backend env vars:
- `SEED_DEFAULT_SUPERUSER`
- `DEFAULT_SUPERUSER_USER_NAME`
- `DEFAULT_SUPERUSER_EMAIL`
- `DEFAULT_SUPERUSER_PASSWORD`

SSE quick test:
1. Open frontend at `http://localhost:5173` and confirm stream status is connected.
2. Click `Send Test Event` in the UI.
3. Or trigger directly:
   `POST http://localhost:8000/api/v1/stream/test` with JSON body `{"message":"hello"}`.

Message history endpoints:
- `GET /api/v1/sessions/{session_id}/messages` (full stored messages)
- `GET /api/v1/sessions/{session_id}/history?format=model` (role/content for agent context)
- `GET /api/v1/sessions/{session_id}/history?format=transcript` (User/Assistant text transcript)

Stop everything:

```powershell
docker compose down
```

Reset database volume:

```powershell
docker compose down -v
```

## Phase 1 Setup

### Backend (Flask)

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Backend runs at `http://localhost:8000`.
Health check: `GET http://localhost:8000/api/v1/health`.

### Frontend (React + Vite + Tailwind)

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

Frontend runs at `http://localhost:5173` and checks backend health on load.

## Migrations (Alembic)

```powershell
cd backend
.\venv\Scripts\Activate.ps1
alembic upgrade head
```
email: swagger@example.com
user_id: d9b58891-5f45-469c-a701-d460f3c1c8c1
