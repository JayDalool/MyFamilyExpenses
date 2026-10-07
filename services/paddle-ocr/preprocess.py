"""Image preprocessing for the PaddleOCR sidecar.

Kept in its own module (only needs numpy + OpenCV, not FastAPI/onnxocr) so the
logic is unit-testable in isolation. `app.py` imports `preprocess_for_ocr`.

No logging of bytes or image content here.
"""

from __future__ import annotations

import math

# Phone photos are shrunk to about 2.5 megapixels (roughly 1370 x 1830 for a 3:4
# photo). Measured on a 12 MP photo: 2.7 s median and 9.3 s worst before, 0.66 s
# after, with the same lines found. A pixel budget, not a long-side cap, so a
# tall thin receipt keeps readable text.
PREPROCESS_MAX_PIXELS = 2_500_000

# Small images are NOT upscaled or contrast-enhanced any more. PP-OCRv6 resizes
# for detection itself; on the 40-image scorecard, upscaling + CLAHE + sharpen
# cut amount accuracy from 97.5% to 90% and doubled the time.


def preprocess_for_ocr(image):
    """Return the image to OCR: shrunk if it is over the pixel budget, else as-is.

    Pure function of `image` — importable for unit tests.
    """
    import cv2

    if image is None or getattr(image, "size", 0) == 0:
        return image

    height, width = image.shape[:2]
    pixels = height * width
    if pixels <= PREPROCESS_MAX_PIXELS:
        return image

    scale = math.sqrt(PREPROCESS_MAX_PIXELS / float(pixels))
    new_w = max(1, int(width * scale))
    new_h = max(1, int(height * scale))
    return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
