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

COPY app.py preprocess.py ./

# Run as a non-root user (no app secrets, no DB, no mounted uploads here).
RUN useradd --create-home --uid 10001 ocr \
    && chown -R ocr:ocr /app
USER ocr

# The PP-OCRv6 model files ship inside the onnxocr wheel, so the image needs no
# network at runtime and /healthz is ready a few seconds after start.

EXPOSE 8000

# Single worker keeps memory predictable; scale concurrency via replicas, not
# threads (OCR is CPU-heavy). See README.md "Resources & concurrency".
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
