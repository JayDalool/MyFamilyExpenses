"""Unit tests for preprocess_for_ocr (numpy + OpenCV only; no FastAPI needed).

Run directly:  python test_preprocess.py
Or with pytest: pytest services/paddle-ocr/test_preprocess.py
"""

import numpy as np

from preprocess import PREPROCESS_MIN_SIDE, preprocess_for_ocr


def test_small_image_is_upscaled_and_three_channel():
    small = np.full((80, 100, 3), 127, dtype=np.uint8)
    out = preprocess_for_ocr(small)
    # Upscaled: both sides grew.
    assert out.shape[0] > small.shape[0]
    assert out.shape[1] > small.shape[1]
    # Still a 3-channel BGR image for PaddleOCR.
    assert out.shape[2] == 3
    assert out.dtype == np.uint8


def test_large_image_is_left_unchanged():
    large = np.full((PREPROCESS_MIN_SIDE, PREPROCESS_MIN_SIDE + 200, 3), 127, dtype=np.uint8)
    out = preprocess_for_ocr(large)
    # No over-processing of already-large/clear images.
    assert out.shape == large.shape
    assert out is large


def test_none_is_safe():
    assert preprocess_for_ocr(None) is None


def test_empty_image_is_safe():
    empty = np.zeros((0, 0, 3), dtype=np.uint8)
    out = preprocess_for_ocr(empty)
    assert out.size == 0


def test_upscale_respects_max_side():
    # A very thin, tiny image: scale capped, longer side never exceeds the guard.
    tiny = np.full((10, 30, 3), 200, dtype=np.uint8)
    out = preprocess_for_ocr(tiny)
    assert max(out.shape[0], out.shape[1]) <= 4000
    assert out.shape[2] == 3


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   - {name}")
            except AssertionError as exc:  # pragma: no cover - direct runner
                failures += 1
                print(f"FAIL - {name}: {exc}")
    raise SystemExit(1 if failures else 0)
