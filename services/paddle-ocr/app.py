"""Internal PaddleOCR sidecar for MyFamilyExpenses.

Contract (app-owned DTO — NOT raw Paddle JSON):

    POST /ocr   (multipart/form-data, field "file" = image bytes)
        -> 200 {
             "text": "combined OCR text",
             "blocks": [
                 {"text": "...", "bbox": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], "score": 0.92}
             ],
             "meanScore": 0.91,
             "modelVersion": "PP-OCRv4"
           }
    GET  /healthz -> 200 {"status": "ok"} once the model is loaded, else 503

Hard rules:
  * Image OCR only. No PDF / rasterization here.
  * Never log file bytes or raw OCR text (only sizes / counts / error codes).
  * No database access, no app secrets — this service knows nothing about the app.
  * All scores are normalized/clamped to 0-1 before leaving the service.
  * Intended to run on an internal Docker network only (no public port).

If PaddleOCR is not installed the service still starts and /healthz reports
503 (not ready); /ocr returns 503. See README.md for install commands.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from preprocess import preprocess_for_ocr

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("paddle-ocr")

# Reject oversized uploads at the service edge (defense in depth; the Next app
# also enforces its own MAX_UPLOAD_MB before ever calling this service).
MAX_UPLOAD_BYTES = int(os.environ.get("OCR_MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MODEL_VERSION = os.environ.get("OCR_MODEL_VERSION", "PP-OCRv4")
OCR_LANG = os.environ.get("OCR_LANG", "en")

app = FastAPI(title="MyFamilyExpenses PaddleOCR", version="0.1.0")

# The model is loaded once at startup (preload) so /healthz only reports ready
# after recognition is actually available. `_ocr` stays None if PaddleOCR is not
# installed, which keeps the scaffold runnable for contract/wiring checks.
_ocr = None
_load_error: str | None = None


def _clamp01(value: float) -> float:
    """Normalize a confidence into 0-1. Paddle reports 0-1 already; clamp anyway."""
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    if score != score:  # NaN
        return 0.0
    if score > 1.0:
        # Treat a stray 0-100 style score defensively before clamping.
        score = score / 100.0
    return max(0.0, min(1.0, score))


@app.on_event("startup")
def _load_model() -> None:
    global _ocr, _load_error
    try:
        from paddleocr import PaddleOCR

        # CPU-only by default; set OCR_USE_GPU=1 only if a GPU is available.
        use_gpu = os.environ.get("OCR_USE_GPU", "0") == "1"
        _ocr = PaddleOCR(use_angle_cls=True, lang=OCR_LANG, use_gpu=use_gpu, show_log=False)
        logger.info("PaddleOCR model loaded (lang=%s, gpu=%s)", OCR_LANG, use_gpu)
    except Exception as exc:  # noqa: BLE001 - we intentionally degrade gracefully
        _load_error = type(exc).__name__
        logger.warning("PaddleOCR not available: %s (service will report not-ready)", _load_error)


@app.get("/healthz")
def healthz() -> JSONResponse:
    if _ocr is None:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "reason": _load_error or "model_not_loaded"},
        )
    return JSONResponse(status_code=200, content={"status": "ok"})


def _decode_image(data: bytes):
    """Decode raw image bytes into an ndarray for PaddleOCR. Raises on invalid input."""
    import numpy as np  # local import keeps startup light when model is absent
    import cv2

    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("undecodable_image")
    return image


def _run_ocr(image) -> dict:
    """Run PaddleOCR and project its native output into the app-owned DTO."""
    raw = _ocr.ocr(image, cls=True)  # type: ignore[union-attr]

    blocks: list[dict] = []
    scores: list[float] = []
    # PaddleOCR returns [[ [box(4 pts), (text, score)], ... ]] (one list per image).
    lines = raw[0] if raw and isinstance(raw, list) and raw[0] else []
    for entry in lines:
        try:
            box, (text, score) = entry
        except (ValueError, TypeError):
            continue
        norm_score = _clamp01(score)
        bbox = [[float(point[0]), float(point[1])] for point in box]
        blocks.append({"text": str(text), "bbox": bbox, "score": norm_score})
        scores.append(norm_score)

    mean_score = _clamp01(sum(scores) / len(scores)) if scores else 0.0
    combined_text = "\n".join(block["text"] for block in blocks)

    return {
        "text": combined_text,
        "blocks": blocks,
        "meanScore": mean_score,
        "modelVersion": MODEL_VERSION,
    }


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)) -> JSONResponse:
    if _ocr is None:
        raise HTTPException(status_code=503, detail="ocr_not_ready")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty_file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")

    try:
        image = _decode_image(data)
    except Exception:  # noqa: BLE001
        # Do not echo bytes; report a coded error only.
        raise HTTPException(status_code=400, detail="invalid_image")

    try:
        image = preprocess_for_ocr(image)
        dto = _run_ocr(image)
    except Exception:  # noqa: BLE001
        logger.error("OCR processing failed (bytes=%d)", len(data))
        raise HTTPException(status_code=500, detail="ocr_failed")

    return JSONResponse(status_code=200, content=dto)
