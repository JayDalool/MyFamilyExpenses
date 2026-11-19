# 0003. PP-OCRv6 sidecar is opt-in; Tesseract stays the default

Date: 2026-10-09. Status: proposed (Jay decides the default after `ocr:bench:real`).
Ticket: MFE-016, PR #12.

## Context

`docs/upgrade-plan.md` (decided 2026-09-30) set the OCR default to Tesseract with the
`single` strategy because the PaddleOCR 2.9 (PP-OCRv4) sidecar was slow and less accurate
on the server's 2 CPUs. That result is out of date: the sidecar now runs PP-OCRv6 small on
ONNX Runtime, with the models bundled in the image and onnxruntime telemetry off. On the 40
generated scorecard receipts it read the amount on 97.5% (100% with Tesseract as
fallback), against 72.5% for Tesseract alone.

Generated receipts are an easy, clean set. The real measure is `npm run ocr:bench:real`
on saved receipts, and nobody has run it with Paddle. Production loads
`docker-compose.ocr.yml`; the live app container passes no OCR_STRATEGY.

## Decision

- The default stays `OCR_PROVIDER=tesseract`, `OCR_STRATEGY=single`, including when
  `docker-compose.ocr.yml` is loaded. The override no longer injects Paddle defaults.
- Paddle is opt-in: `OCR_PROVIDER=paddle` + `OCR_STRATEGY=fallback` in the app's
  environment file.
- The app has no `depends_on` on the sidecar. A missing, slow or unhealthy sidecar must not
  stop `docker compose up`. With `fallback` the app reads with Tesseract when the sidecar
  fails; the OCR client timeout (`OCR_TIMEOUT_MS`, 1-8 s) bounds the wait.
- The sidecar keeps: no internet (`internal` network), no uploads volume, no DB or secrets,
  unchanged HTTP contract, Apache-2.0/MIT licensed models and runtime.
- Jay runs `ocr:bench:real` with paddle + fallback and decides whether to change the
  default; that is a one-line config change plus a new ADR status.

## Alternatives considered

- **Default to Paddle + fallback now.** Rejected: unmeasured on real receipts, and merging
  plus the next `up` would silently change production OCR.
- **Keep `depends_on: service_healthy`.** Rejected: a failed image build or unhealthy
  sidecar would take the whole app down for an optional accuracy feature.
- **Remove the sidecar.** Rejected: the generated-receipt gain is large enough to justify
  measuring it properly.

## Why this option

It ships the code and image without changing behaviour, makes the switch a deliberate
config change, and keeps the app's availability independent of the sidecar.

## Consequences

- Nothing changes in production until Jay edits the app's configuration.
- `fallback` costs up to `OCR_TIMEOUT_MS` per upload only when the sidecar hangs; a
  refused connection fails at once.
- With paddle + `single` and a dead sidecar the user sees the manual-entry OCR error, so
  documentation says to use `fallback`.
- About 1 GB RAM and 2 CPUs for the sidecar when it runs.

## Future considerations

- After the real benchmark, either make paddle + fallback the default (supersede this ADR)
  or drop the sidecar.
- PDF bills (step 6e) read the text layer and do not need the sidecar.
- A health-aware skip (do not call a sidecar known to be down) is not built; add it only
  if the timeout wait shows up in practice.
