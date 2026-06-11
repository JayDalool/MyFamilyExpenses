# PaddleOCR sidecar (experimental)

Internal OCR service for MyFamilyExpenses. The Next.js app talks to it over HTTP
through the `OcrEngine` boundary (`lib/ocr/paddle-ocr-engine.ts`) when
`OCR_PROVIDER=paddle`.

> **Status: experimental / opt-in.** Production default remains
> `OCR_PROVIDER=tesseract`. This service is scaffolded and wired, but the
> PaddleOCR model has not been load-tested in this repo's CI. Validate locally
> before relying on it.

## What it is

- A small **FastAPI** app exposing exactly two routes.
- **Image OCR only.** No PDF / rasterization.
- Returns an **app-owned DTO**, never raw Paddle JSON.
- Receives **file bytes** via multipart upload — never filesystem paths.
- **No database access, no app secrets**, intended for an **internal Docker
  network only** (no public port).

## API contract

### `GET /healthz`
- `200 {"status":"ok"}` once the model is loaded.
- `503 {"status":"not_ready", ...}` if PaddleOCR is not installed/loaded yet.

### `POST /ocr`
- `multipart/form-data`, field **`file`** = image bytes.
- Success `200`:

  ```json
  {
    "text": "combined OCR text",
    "blocks": [
      { "text": "line text", "bbox": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], "score": 0.92 }
    ],
    "meanScore": 0.91,
    "modelVersion": "PP-OCRv4"
  }
  ```
- `score` and `meanScore` are normalized/clamped to **0–1**.
- Error codes (detail string): `empty_file` (400), `invalid_image` (400),
  `file_too_large` (413), `ocr_not_ready` (503), `ocr_failed` (500).
- File bytes and raw OCR text are **never logged** (only sizes / counts / codes).

## Run locally (real PaddleOCR)

PaddleOCR pulls heavy ML dependencies (`paddlepaddle`, `paddleocr`, OpenCV) and
downloads model files on first use. CPU-only is the default.

```bash
cd services/paddle-ocr
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
```

First request triggers a one-time model download. Until the model is loaded,
`/healthz` returns `503`.

### Preloading the model
To make `/healthz` ready immediately (and avoid a slow first request), pre-warm
the model during the Docker build by adding, after `COPY app.py`:

```dockerfile
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en', use_gpu=False)"
```

This downloads and caches the detection/recognition/angle models into the image.

## Configuration

| Env | Purpose | Default |
|---|---|---|
| `OCR_LANG` | PaddleOCR language | `en` |
| `OCR_MODEL_VERSION` | Value reported as `modelVersion` | `PP-OCRv4` |
| `OCR_MAX_UPLOAD_BYTES` | Reject larger uploads at the edge | `15728640` (15 MB) |
| `OCR_USE_GPU` | Use GPU build (only if CUDA present) | `0` |

## Resources & concurrency

- **CPU-bound.** Recognition can take ~1–4 s/image on CPU. The Next engine
  enforces a 5–8 s total timeout (`OCR_TIMEOUT_MS`).
- Run **one uvicorn worker** per container; scale by adding container replicas
  rather than threads. Set CPU/memory limits in Compose.
- Models + runtime need roughly **1–2 GB RAM**; size the container accordingly.

## Security notes

- Do **not** publish the service port publicly — internal Docker network only.
- Do **not** mount the uploads volume into this service; bytes are passed
  per-request.
- Runs as a non-root user in the image.
- No DB credentials or app secrets are provided to this service.

## How the app calls it

Set on the **app** container (not here):

```
OCR_PROVIDER=paddle
OCR_SERVICE_URL=http://ocr:8000
OCR_TIMEOUT_MS=7000   # optional; clamped to 1000–8000 by the engine
```

See `docs/deployment-self-hosted.md` for the Compose wiring.
