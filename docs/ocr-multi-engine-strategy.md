# OCR Multi-Engine Strategy (Stage A.2)

This describes the 3-layer OCR pipeline added in Stage A.2 and the parser
confidence/calibration fixes that ship with it. No database, no persistence, no
external AI — everything runs in-process.

## Layers

1. **Primary engine (Paddle preferred for layout).** Runs first and supplies
   block geometry (bbox) the parser uses for multi-receipt detection and
   candidate positioning.
2. **Fallback engine (conditional).** A second engine runs **only when the
   primary result is weak** (see triggers) — not on every receipt, for
   performance and to avoid adding noise.
3. **Candidate merger / decision engine.** Both results are parsed separately,
   then merged: agreement boosts confidence, disagreement lowers it and surfaces
   both candidates. Paddle geometry is preserved; Tesseract candidates may have
   no bbox.

## Configuration

| Env | Values | Default | Meaning |
|---|---|---|---|
| `OCR_PROVIDER` | `tesseract` \| `paddle` \| `mock` | `tesseract` | Primary engine. `mock` is dev/test only (blocked in production). |
| `OCR_STRATEGY` | `single` \| `fallback` \| `parallel` | `single` | How many engines run. |

- **single** (default): run the selected provider only. Behavior is identical to
  before Stage A.2 — production stays on `tesseract`/`single` unless changed.
- **fallback**: run the primary, then the *other* reliable engine **only if** the
  primary result is weak. Recommended override: `OCR_PROVIDER=paddle` +
  `OCR_STRATEGY=fallback`.
- **parallel**: always run both and merge. Opt-in, for local testing — it doubles
  OCR cost per receipt.

The fallback/secondary engine is the other of `paddle`/`tesseract`; `mock` has no
fallback. If the secondary can't be constructed (e.g. `paddle` without
`OCR_SERVICE_URL`), it is skipped gracefully and the primary result is used.

## Why fallback is conditional (not always-on)

Running both engines on every upload doubles latency and CPU and can *add* noise:
two engines that both read a clear receipt rarely improve the answer, but a
second engine's stray candidates can muddy the merge. So the fallback only fires
when the primary is genuinely uncertain.

**Fallback triggers** (any one):
- amount confidence `< 0.65`
- date confidence `< 0.60`
- OCR text shorter than 40 characters
- multi-receipt detected
- parser warning "could not confidently identify…"
- image quality is low (small/low-res) but OCR still produced something
- the primary engine threw (outage) — the fallback then runs as primary

## Merge rules

- Normalize before comparing: dates as ISO, amounts to integer cents, invoice
  numbers uppercased and stripped of punctuation.
- **Agree** → keep the value (primary's, for geometry) and **boost** confidence.
- **Only one engine found it** → use that one (this is how a Paddle miss is filled
  by Tesseract, and vice-versa).
- **Strong candidates disagree** → take the higher-confidence value but **lower**
  its confidence and surface **both** candidates in the UI (wrong amount is worse
  than blank). A "two engines read different amounts" warning is added.
- Invoice numbers are never taken from weak/unlabelled generic text — labelled
  candidates only.

## Why the merger is safer than trusting one engine

A single engine has systematic blind spots (Paddle may mis-segment a column;
Tesseract may garble layout). Cross-checking two independent reads lets us (a)
*raise* confidence only when they corroborate, and (b) *refuse to guess* when they
conflict — surfacing choices to the user instead of silently picking a wrong
financial value.

## Provenance (additive `meta`)

Each extraction response carries `meta` (optional, backward-compatible):
`strategy`, `primaryProvider`, `fallbackProvider`, `providersUsed`,
`modelVersions`, `fallbackReason`. Raw OCR text is never logged.

## Parser confidence / calibration fixes (Stage A.2)

- **Multi-receipt false positive fixed:** a single receipt with an item column +
  a price column no longer triggers it. Detection now requires a wide horizontal
  split **and** that *both* clusters contain receipt structure (their own
  total/date/header) — a bare price column does not qualify.
- **Invoice hallucination fixed:** the unlabelled/"weak" invoice fallback was
  removed; address/phone/placeholder lines (Address, Street, Tel, Lorem, …) are
  rejected. No clear label ⇒ blank invoice number.
- **Date calibration:** `01-01-2018` (day == month) is treated as unambiguous and
  gets normal (medium/high) confidence instead of an ambiguity penalty.
- **UI severity:** date + amount are the critical household fields; a missing
  invoice number no longer makes a receipt look failed. A small image with useful
  fields shows a soft "verify values" note instead of the harsh "could not read"
  warning.

## Still not learning

The app still does **not** learn from corrections. That requires the
`ReceiptExtractionAttempt` (trusted handoff) and `CorrectionFeedback` (predicted
vs final) tables described in `docs/phase6-ocr-intelligence-plan.md` — Stage B/C,
which need migrations and are not part of this phase.
