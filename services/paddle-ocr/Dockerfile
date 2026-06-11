# PaddleOCR sidecar — CPU-only, internal network only.
FROM python:3.11-slim

# System libs PaddleOCR / OpenCV need at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# Run as a non-root user (no app secrets, no DB, no mounted uploads here).
RUN useradd --create-home --uid 10001 ocr \
    && chown -R ocr:ocr /app
USER ocr

# Model files download on first run into the user's cache. To bake them into the
# image instead (so /healthz is ready immediately), pre-warm during build — see
# README.md "Preloading the model".

EXPOSE 8000

# Single worker keeps memory predictable; scale concurrency via replicas, not
# threads (PaddleOCR is CPU-heavy). See README.md "Resources & concurrency".
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
