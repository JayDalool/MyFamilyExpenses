"""Unit tests for preprocess_for_ocr (numpy + OpenCV only; no FastAPI needed).

Run directly:  python test_preprocess.py
Or with pytest: pytest services/paddle-ocr/test_preprocess.py
"""

import numpy as np

from preprocess import PREPROCESS_MAX_PIXELS, preprocess_for_ocr


def test_small_image_is_left_unchanged():
    # PP-OCRv6 resizes for detection itself; upscaling here measured worse.
    small = np.full((80, 100, 3), 127, dtype=np.uint8)
    out = preprocess_for_ocr(small)
    assert out is small


def test_image_at_budget_is_left_unchanged():
    side = int(PREPROCESS_MAX_PIXELS**0.5)
    image = np.full((side, side, 3), 127, dtype=np.uint8)
    assert preprocess_for_ocr(image) is image


def test_phone_photo_is_shrunk_under_budget_keeping_aspect():
    photo = np.full((4032, 3024, 3), 127, dtype=np.uint8)  # 12 MP, 3:4
    out = preprocess_for_ocr(photo)
    assert out.shape[0] * out.shape[1] <= PREPROCESS_MAX_PIXELS
    assert abs(out.shape[0] / out.shape[1] - 4032 / 3024) < 0.01
    assert out.shape[2] == 3
    assert out.dtype == np.uint8


def test_tall_receipt_keeps_its_length():
    # A pixel budget, not a long-side cap: a 1:4 receipt stays over 3000 px tall.
    receipt = np.full((6000, 1500, 3), 127, dtype=np.uint8)
    out = preprocess_for_ocr(receipt)
    assert out.shape[0] > 3000
    assert out.shape[0] * out.shape[1] <= PREPROCESS_MAX_PIXELS


def test_none_is_safe():
    assert preprocess_for_ocr(None) is None


def test_empty_image_is_safe():
    empty = np.zeros((0, 0, 3), dtype=np.uint8)
    out = preprocess_for_ocr(empty)
    assert out.size == 0


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
