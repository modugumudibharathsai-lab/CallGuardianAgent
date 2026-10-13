FROM node:22.14-alpine AS frontend-build
WORKDIR /src/frontend
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py db.py gemini_config.py ./
# Root-level static files served at /login.html, /register.html, etc.
COPY login.html register.html index.html auth.css styles.css app.js chat-workflow.js ./
COPY frontend/ ./frontend/
COPY --from=frontend-build /src/frontend/dist ./frontend/dist
EXPOSE 10000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
