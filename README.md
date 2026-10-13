# CallGuardianAI

CallGuardianAI is a React dashboard for **simulated** call screening. It uses a
Vite frontend, a FastAPI backend, SQLite for accounts and call history, Gemini
for call analysis, and the browser's Web Speech API for optional playback. It
does not connect to a telephone network or place or receive real calls.

## Architecture

- `frontend/`: React 19, TypeScript, Vite, and React Router SPA.
- `main.py`: FastAPI API and backend-only Gemini integration (`google-genai`).
- `db.py`: SQLite accounts, sessions, call records, and analysis storage.
- The same SQLite database contains incremental caller/assistant transcript
  messages and an internal appointment calendar. `init_db()` runs additive
  `CREATE TABLE`/`ALTER TABLE` migrations on startup, retaining existing calls.
- Appointments are checked against this account's internal calendar only;
  business hours are weekdays 9 AM–5 PM in the selected timezone, with a
  30-minute default slot. Google Calendar, Outlook, staff rosters, and holidays
  are not connected or checked.
- `/health`: process health check; it does not depend on Gemini credentials.
- `/config-status`: reports only whether a Gemini key is configured.

Production uses one Docker-based Render Web Service. FastAPI serves the built
SPA and API from the same HTTPS origin, keeping browser sessions first-party
and avoiding a second service or cross-origin cookie dependency. The service
uses a persistent disk because the application stores users, sessions, CAPTCHA
challenges, and call history in SQLite. The disk means it must remain a single
instance. Existing local
`callguardian.db` data is not automatically copied to Render.

## Local setup (PowerShell)

Use Python 3.10+ and Node.js 22.14+.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -r requirements-test.txt
Copy-Item .env.example .env
```

Set `GEMINI_API_KEY` in the project `.env` for real Gemini requests. Keep the
key in the backend environment only; never use a `VITE_` variable for it. The
backend loads `.env` relative to `main.py`, without overriding hosting
environment variables. The default model is `gemini-3.8-flash`; change
`GEMINI_MODEL` only to a model enabled for the key's project.

Run the API and frontend in separate terminals:

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

```powershell
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm run dev
```

Open the Vite URL printed by the frontend (normally `http://127.0.0.1:5500`).
Vite proxies the API routes to `http://127.0.0.1:8001` so the browser uses its
own origin for CAPTCHA, authentication, and API requests. Set `VITE_API_URL`
in `frontend/.env.local` only if your local backend uses a different origin;
the browser will still send API requests through Vite.

The Call History page is account-scoped and keeps call metadata and message
transcripts in SQLite. Messages save before Gemini runs, and responses save
after the backend returns them; sensitive credential requests are redacted in
persisted transcript text. The Appointments page checks and books against the
SQLite calendar. In the assistant, clear phrases such as “book an appointment
tomorrow at 3 PM” are interpreted only when date/time and contact name are
clear; other requests ask for clarification. Reschedule/cancel actions require
selecting a specific saved appointment in the Appointments page.

The API exposes authenticated `GET /appointments`, `GET
/appointments/availability`, `POST /appointments`, `GET /appointments/{id}`,
`POST /appointments/{id}/reschedule`, and `POST /appointments/{id}/cancel`.
Call persistence uses `POST /calls/start`, `POST /calls/{id}/transcript`, and
the existing `/calls` history/detail APIs. Deleting a call deletes its
transcript, analysis, and call-linked appointments. Schema changes are
additive and run automatically when FastAPI starts; back up the SQLite file
before production upgrades as part of normal operations.

## Render deployment with the Blueprint

1. Commit and push this repository to GitHub.
2. In Render, choose **New + → Blueprint**, connect the GitHub repository, and
   select the branch containing `render.yaml`.
3. Review the `callguardianai` Docker Web Service. The Blueprint configures its
   `/health` check, a 1 GB persistent disk at `/var/data`, HTTPS cookies, and
   one Uvicorn worker. Keep the service at one instance while using SQLite.
4. Set `GEMINI_API_KEY` in the Web Service's Environment settings to a valid
   Gemini Developer API key. The Blueprint prompts for it on initial creation;
   for an existing service, enter it manually and save/deploy. Never put it in
   GitHub, `render.yaml`, or a `VITE_` variable.
5. Use the public URL assigned to the service in the Render dashboard. Confirm
   `/health` returns `{"status":"ok"}` and `/captcha` returns JSON containing
   `id` and `question` before connecting a frontend. Set
   `CORS_ALLOWED_ORIGINS` to the exact frontend origin when the UI is hosted
   separately.
6. Inspect build and runtime logs. Open the site, register an account,
   sign in, and send two consecutive assistant messages. `/health` should return
   `{"status":"ok"}`. The chat uses live Gemini only when a real key is set.

The Blueprint uses Render's paid Starter Web Service and persistent disk to
preserve SQLite data. Confirm current Render pricing before creating resources.
Render disks are single-instance and are not available to build commands. For
larger or multi-instance production deployments, migrate SQLite to a managed
PostgreSQL database and move login rate limiting to shared storage.

## Environment variables

| Service | Variable | Value |
| --- | --- | --- |
| Web Service | `GEMINI_API_KEY` | Required for Gemini chat; private Render secret |
| Web Service | `GEMINI_MODEL` | `gemini-3.8-flash` by default |
| Web Service | `CALLGUARDIAN_DB_PATH` | `/var/data/callguardian.db` on Render |
| Web Service | `AUTH_COOKIE_SECURE` | `true` on HTTPS |
| Web Service | `CORS_ALLOWED_ORIGINS` | Exact origin(s), no wildcard; same-origin in production |
| Frontend (local override only) | `VITE_API_URL` | Public API URL; leave unset in the same-origin production build |
| Netlify build | `PROD_API_LOCATION` | Public HTTPS API origin used by the same-origin proxy; not a secret |

For the existing standalone HTML UI on Netlify, `netlify.toml` publishes the
same login, registration, and dashboard files and proxies API routes to the
Render service. Set `PROD_API_LOCATION` to the verified Render HTTPS origin and
set `CORS_ALLOWED_ORIGINS` on Render to the exact Netlify site origin.
That legacy standalone Netlify UI is separate from `frontend/` and does not
include the new React Appointments page. The React call-history and appointment
screens are included in the Render Docker build; to expose them on Netlify, its
publish build must be changed to build and publish `frontend/` while retaining
the API redirects.

`/health` reports process health even when `GEMINI_API_KEY` is missing. A chat
request then returns a clear configuration error. Invalid credentials, quota
errors, unsupported models, timeouts, and network failures are classified
without logging credentials or caller prompt text.

## Checks

```powershell
python -m pytest -q
python -m compileall -q main.py db.py gemini_config.py
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

The browser end-to-end test starts a temporary API database and Vite server.
It needs `requirements-test.txt`, installed frontend dependencies, and a
Playwright Chromium install (`python -m playwright install chromium`). It checks
registration, CAPTCHA, login/logout routing, two chat turns, call completion,
Agent Mode, known callers, history, analytics, exports, and the text fallback
when browser speech fails and a confirmed internal-calendar booking. Provider-backed Gemini chat is separately tested
with the mocked backend suite; `python test_gemini.py` is the optional real-key
smoke test.

The repository also retains an older standalone prototype under
`welcome hackthon/`. Its backend scenario script is run separately with
`python "welcome hackthon/backend/test_backend.py"`; pytest excludes that folder
to keep the two applications' separate `main.py` modules from colliding.

The optional live Gemini smoke test below sends a real request and may consume
quota:

```powershell
python test_gemini.py
```
