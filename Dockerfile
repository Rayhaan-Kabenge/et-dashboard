# Backend image: vendored engine + FastAPI app.
# Build context is the repo root (it needs both engine/ and backend/).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Install deps first for better layer caching.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

# Vendored engine (installed unchanged; pulls in pyfao56).
COPY engine/ ./engine/
RUN pip install ./engine

# App code (includes the bundled demo sample sheet for DEMO mode).
COPY backend/ ./backend/

WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
