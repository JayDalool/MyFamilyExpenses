# PaddleOCR sidecar (PP-OCRv6)

Internal OCR service for MyFamilyExpenses. The Next.js app talks to it over HTTP
through the `OcrEngine` boundary (`lib/ocr/paddle-ocr-engine.ts`) when
`OCR_PROVIDER=paddle`.

> **Status: opt-in.** Runs PP-OCRv6 small on ONNX Runtime (CPU) through the
> [`onnxocr`](https://pypi.org/project/onnxocr/) package. On the 40 generated
> scorecard receipts (`npm run ocr:bench`) it read the amount on 97.5% (100% with
> `OCR_STRATEGY=fallback`) against Tesseract's 72.5%, and 10 of 10 faded receipts
> against 0. Confirm on saved receipts with `npm run ocr:bench:real` before
> switching production.

## What it is

- A small **FastAPI** app exposing exactly two routes.
- **Image OCR only.** No PDF / rasterization.
- **Preprocessing** (`preprocess.py`): photos over 2.5 megapixels are shrunk to
  that budget (a 12 MP photo went from 2.7 s to 0.66 s with the same lines
  found). Smaller images are passed through untouched: upscaling and contrast
  enhancement made PP-OCRv6 less accurate and twice as slow.
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
    "modelVersion": "PP-OCRv6-small"
  }
  ```
- `score` and `meanScore` are normalized/clamped to **0–1**.
- Error codes (detail string): `empty_file` (400), `invalid_image` (400),
  `file_too_large` (413), `ocr_not_ready` (503), `ocr_failed` (500).
- File bytes and raw OCR text are **never logged** (only sizes / counts / codes).

## Run locally

CPU-only. The PP-OCRv6 small and tiny model files ship inside the `onnxocr`
wheel, so nothing is downloaded at runtime.

```bash
cd services/paddle-ocr
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
```

The model loads in a few seconds at startup. Until then `/healthz` returns `503`.

To score this service against the repo's receipts, run it on port 8000 and then,
from the repo root:

```bash
OCR_PROVIDER=paddle OCR_STRATEGY=fallback OCR_SERVICE_URL=http://127.0.0.1:8000 npm run ocr:bench
```

## Configuration

| Env | Purpose | Default |
|---|---|---|
| `OCR_MODEL_SIZE` | PP-OCRv6 size: `small`, or `tiny` (about twice as fast, weaker on dates and faded text). Also reported as `modelVersion` | `small` |
| `OCR_THREADS` | ONNX Runtime threads. Keep equal to the container's CPU limit: the runtime counts the host's cores, and a larger pool gets throttled | `2` |
| `OCR_MAX_UPLOAD_BYTES` | Reject larger uploads at the edge | `15728640` (15 MB) |

`OCR_LANG`, `OCR_MODEL_VERSION` and `OCR_USE_GPU` are gone: the PP-OCRv6 model
covers English and French in one model, the version comes from
`OCR_MODEL_SIZE`, and the image is CPU-only.

## Resources & concurrency

- **CPU-bound.** About 0.5 s for a generated receipt and 1–2.5 s for a 12 MP
  phone photo on 2 threads, measured in a 4-core sandbox. The Next engine
  enforces a 5–8 s total timeout (`OCR_TIMEOUT_MS`).
- Run **one uvicorn worker** per container; scale by adding container replicas
  rather than threads. Set CPU/memory limits in Compose.
- Models + runtime peaked at about **1 GB RAM**; the Compose limit is 2 GB.

## Security notes

- Do **not** publish the service port publicly — internal Docker network only.
- **No route to the internet.** `docker-compose.ocr.yml` puts the service only on
  the `ocr-internal` network, which Docker marks `internal`. onnxruntime's
  built-in usage telemetry to Microsoft is also switched off
  (`ORT_DISABLE_TELEMETRY=1` and `disable_telemetry_events()`); without that,
  onnxruntime 1.30 tried to reach `mobile.events.data.microsoft.com`.
- Do **not** mount the uploads volume into this service; bytes are passed
  per-request.
- Runs as a non-root user in the image.
- No DB credentials or app secrets are provided to this service.

## How the app calls it

Set on the **app** container (not here):

```
OCR_PROVIDER=paddle
OCR_STRATEGY=fallback # Tesseract runs only when the PP-OCRv6 result is weak
OCR_SERVICE_URL=http://ocr:8000
OCR_TIMEOUT_MS=7000   # optional; clamped to 1000–8000 by the engine
```

See `docs/deployment-self-hosted.md` for the Compose wiring.
