"""Image preprocessing for the PaddleOCR sidecar.

Kept in its own module (only needs numpy + OpenCV, not FastAPI/PaddleOCR) so the
logic is unit-testable in isolation. `app.py` imports `preprocess_for_ocr`.

No logging of bytes or image content here.
"""

from __future__ import annotations

# Preprocessing thresholds. Small/low-res receipts benefit from upscaling and mild
# enhancement; large, already-clear images are left untouched (over-processing can
# hurt recognition).
PREPROCESS_MIN_SIDE = 1000  # upscale until the shorter side reaches ~this
PREPROCESS_MAX_SIDE = 4000  # never upscale beyond this (memory guard)
PREPROCESS_MAX_SCALE = 3.0


def preprocess_for_ocr(image):
    """Return an OCR-friendlier copy of a decoded BGR image.

    Safe, conservative steps applied ONLY to small/low-res images:
      * upscale (cubic) so the shorter side approaches PREPROCESS_MIN_SIDE,
      * grayscale + CLAHE for local contrast,
      * a mild unsharp-mask sharpen,
    then return a 3-channel image (PaddleOCR expects BGR). Large, clear images are
    returned unchanged. Pure function of `image` — importable for unit tests.
    """
    import cv2
    import numpy as np  # noqa: F401 - imported so the dependency is explicit

    if image is None or getattr(image, "size", 0) == 0:
        return image

    height, width = image.shape[:2]
    min_side = min(height, width)
    if min_side <= 0:
        return image

    # Large and already detailed enough — do not over-process.
    if min_side >= PREPROCESS_MIN_SIDE:
        return image

    processed = image

    # 1) Upscale small images.
    scale = min(PREPROCESS_MAX_SCALE, max(2.0, PREPROCESS_MIN_SIDE / float(min_side)))
    new_w = int(round(width * scale))
    new_h = int(round(height * scale))
    # Clamp the longer side so we never blow past the memory guard.
    longer = max(new_w, new_h)
    if longer > PREPROCESS_MAX_SIDE:
        clamp = PREPROCESS_MAX_SIDE / float(longer)
        new_w = max(1, int(round(new_w * clamp)))
        new_h = max(1, int(round(new_h * clamp)))
    if new_w > width or new_h > height:
        processed = cv2.resize(processed, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    # 2) Grayscale + adaptive contrast.
    gray = cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # 3) Mild unsharp-mask sharpen (gentle weights so we don't amplify noise).
    blurred = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.0)
    sharpened = cv2.addWeighted(enhanced, 1.3, blurred, -0.3, 0)

    # PaddleOCR's pipeline expects a 3-channel image.
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)
