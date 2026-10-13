# Authentication and browser setup

The Vite React application calls the FastAPI backend with credentialed requests.
In production, FastAPI serves the built React app and API from one HTTPS origin,
so HttpOnly session cookies and the readable CSRF token work without a
cross-origin cookie dependency.

## Local development

Install backend and frontend dependencies, then run the API and Vite development
server in separate terminals:

```powershell
python -m pip install -r requirements.txt -r requirements-test.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

```powershell
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm run dev
```

Open the Vite URL (normally `http://127.0.0.1:5500`). Local Vite development
uses `http://127.0.0.1:8001` for the API. To use a different API, define
`VITE_API_URL` in `frontend/.env.local`; this is a public URL, never a secret.

Registration requires a valid email format and a password that meets the policy
returned by `/auth/password-policy`. Email ownership is not verified. CAPTCHA
answers are checked and consumed by the backend; a failed or expired challenge
must be refreshed. Passwords are stored using Argon2id, and session tokens are
stored hashed in SQLite. State-changing requests require the double-submit CSRF
token.

## Production

Use the repository's Dockerfile Blueprint. It serves the frontend and API from
the same origin and writes SQLite to the mounted persistent disk. Configure
`GEMINI_API_KEY` in the Render Web Service environment. Set
`AUTH_COOKIE_SECURE=true`; do not set the Gemini key in any frontend variable.

Use the exact public origin in `CORS_ALLOWED_ORIGINS` when the UI or API is
served from another browser origin. Credentialed CORS must use explicit origins.

## Data and product boundaries

Calls recorded before accounts existed remain in SQLite but have no trustworthy
owner, so they are not shown or exported to an account. New calls, analytics,
and exports are account-scoped by the backend. Browser contacts, Agent Mode, and
voice preferences are stored in that browser profile's local storage.

Agent Mode and call outcomes control only simulated calls. No cellular call,
caller ID lookup, live monitoring, microphone capture, or telephony provider is
implemented. Spoken playback uses the browser's installed Web Speech API voice;
it does not require another API key and the app provides text when playback is
unsupported or fails.

The existing `callguardian.db` is preserved locally. Tests use temporary
databases and do not rewrite it.
