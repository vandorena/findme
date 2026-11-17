# syntax=docker/dockerfile:1
# The solver: listens to 5 s audio chunks relayed by the Rails app and matches them against live ADS-B.
# Only the Rails container should reach it (internal network); set SOLVER_KEY on both sides.
FROM docker.io/library/python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DEM_CACHE=/data/dem
WORKDIR /solver

RUN apt-get update -qq && apt-get install --no-install-recommends -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN groupadd --system --gid 1000 solver && useradd solver --uid 1000 --gid 1000 && \
    mkdir -p /data/dem && chown solver:solver /data/dem
USER 1000:1000
VOLUME /data/dem

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

EXPOSE 8000
# One process: sessions live in memory. Threads (SOLVER_THREADS) run the solver ticks.
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
