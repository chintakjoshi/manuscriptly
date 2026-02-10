# kaka-the-writer

Local prototype for a content-writing agent.

## Phase 1 Setup

### Backend (Flask)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
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
.\.venv\Scripts\Activate.ps1
alembic upgrade head
```
