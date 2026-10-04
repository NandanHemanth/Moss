# Moss in one container: the backend serves the built frontend on a single port.
# NOTE: written from the documented build steps but not built in CI yet; see docs/05-deploy.md.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
EXPOSE 8000
CMD ["sh", "-c", "python -m moss.seed && uvicorn moss.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
