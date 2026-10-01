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
| `OCR_STRATEGY` | `single` \| `fallback` \| `parallel` \| `ensemble` | `single` | How many engines/strategies run. |

- **single** (default): run the selected provider only. Behavior is identical to
  before Stage A.2 — production stays on `tesseract`/`single` unless changed.
- **fallback**: run the primary, then the *other* reliable engine **only if** the
  primary result is weak. Recommended override: `OCR_PROVIDER=paddle` +
  `OCR_STRATEGY=fallback`.
- **parallel**: always run both engines and merge. Opt-in, for local testing — it
  doubles OCR cost per receipt.
- **ensemble**: parallel engines **plus** the legacy/simple parser strategy run on
  each engine's text, all merged with the same voting/agreement boosts. This is
  the "many readers, then vote" mode.

### Recommended production configuration

**Until Paddle is validated in production, use:**

```dotenv
OCR_PROVIDER=tesseract
OCR_STRATEGY=single
```

This is the only configuration that runs one known-good local engine with a
predictable latency profile and no dependency on the Paddle sidecar.

**Do not use `ensemble` (or `parallel`) as the production default while the
engines run sequentially.** In the current orchestrator the primary engine is
awaited *before* the secondary/legacy strategies run, so a slow or unreachable
Paddle sidecar makes the whole request wait on Paddle's full timeout window
(`OCR_TIMEOUT_MS`, up to 8 s) **before** Tesseract even starts — the user pays
Paddle's worst case plus Tesseract's time on every upload. An observed failure
mode is a request that stored `providersUsed=["tesseract"]`: Paddle produced no
usable result, but the request still absorbed Paddle's latency first. Ensemble
also doubles CPU per receipt for a benefit that only materializes on genuinely
ambiguous receipts.

`ensemble`/`parallel` remain useful for **local evaluation** of a candidate
Paddle deployment, and `fallback` (`OCR_PROVIDER=paddle` + `OCR_STRATEGY=fallback`)
is the intended path once Paddle's reliability and latency are proven — it runs
the second engine only when the primary result is weak. Neither should be the
production default until then.

### OCR diagnostics (observability)

Every extraction now carries safe, internal-only diagnostics (attached to the
extraction envelope; **never** returned to the client). For each engine attempt
they record `provider`, `status` (`success` \| `timeout` \| `error` \| `skipped`),
`durationMs`, and — for non-success — a stable `errorCode` and a fixed
`safeReason`. Envelope-level fields track `selectedProvider`,
`selectedProviderDurationMs` (the engine whose result was used) and
`totalDurationMs` (the whole orchestration), so a slow/failed engine is visible
distinctly from the result actually used. These diagnostics carry **no raw OCR
text, blocks, receipt content, provider message strings, or other sensitive
data**, and a safe subset is emitted to the audit log on `/extract`. This is how a
"Paddle timed out, Tesseract answered" request becomes observable instead of
silently slow.

### Engines vs parsers vs merger

- **Engine** = OCR recognition (Paddle, Tesseract). Produces text + optional block
  geometry. It never extracts fields.
- **Parser strategy** = turns recognized text into field candidates. Two run:
  - the **layout-aware parser** (`ocr-parsing.ts`) — the full strategy that uses
    labels, receipt-type, geometry, denylists, and ranked candidates;
  - the **legacy/simple parser** (`legacy-parser.ts`) — a small, high-precision
    regex strategy that only fires on the most obvious patterns ("Total 84.80",
    "Date: 01-01-2018", "Invoice No X"). It is **new in Stage A.3**, written to fit
    the "simple reader that's reliable on easy receipts" role (it is not a
    resurrected old parser). It is trustworthy when it speaks and silent
    otherwise, which makes it a good corroborating voter.
- **Merger / decision engine** (`merge.ts`) = normalizes and votes across all
  candidate sources. Agreement boosts; disagreement lowers confidence and surfaces
  both candidates; a field only one source found is filled from that source.

### Field weighting (decision engine)

- **Amounts**: labelled totals from any source win over item prices; agreement
  across sources helps most; Paddle layout (bottom/right totals) and the legacy
  "Total <amount>.<cc>" matcher are both strong signals; never trust an
  unlabelled/weak number.
- **Dates**: a labelled Date line wins; agreement boosts; genuinely ambiguous
  day/month (both ≤ 12, not equal) lowers confidence — the legacy parser declines
  ambiguous dates entirely and leaves them to the layout parser.
- **Merchant/letters**: top-of-receipt lines only; address/phone/tax lines are
  rejected; used as a label fallback, never as an invoice number.

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

## Error handling & no-invoice receipts (Stage A.3)

- **No raw schema errors reach users.** Every expense validation failure is mapped
  to a friendly, field-aware message (`friendlyExpenseError`). The old
  "Invalid input: expected string, received undefined" leak (a missing
  `invoiceNumber` hitting a required `z.string()`) is gone.
- **No-invoice receipts are saveable.** Bank/ATM and cash slips often have no
  invoice/reference number. The DB still requires a non-empty `invoiceNumber`, so
  when one is genuinely absent (and none was typed) the save route mints a
  household-scoped **internal reference** (`AUTO-000001`, `AUTO-000002`, …) inside
  the create transaction, under a per-household Postgres advisory lock so
  concurrent saves never collide (Phase 2; see
  [ocr-reliability-roadmap.md](./ocr-reliability-roadmap.md)). It is a storage
  value only — **never shown as an OCR-detected/vendor invoice number** — and the
  amount is **never** generated (a wrong amount is worse than a blank one). A
  user-typed or confidently OCR-detected number is always used verbatim.
- **Merchant extraction** pulls a vendor name from the top of the receipt (skipping
  address/phone/total/date lines) for use as the label fallback and for display.

### Future product fix (Stage B/C)

Make `invoiceNumber` optional and add a dedicated `receiptLabel` /
`documentReference` column instead of overloading `invoiceNumber`. With the
`ReceiptCorrection` corpus, generated labels can become merchant-sequenced
("McDonalds 1", "McDonalds 2") — but that needs a uniqueness/lookup query and a
migration, so it is deferred (not done tonight).

## Still not learning

The app still does **not** learn from corrections. That requires the
`ReceiptExtractionAttempt` (trusted handoff) and `CorrectionFeedback` (predicted
vs final) tables described in `docs/phase6-ocr-intelligence-plan.md` — Stage B/C,
which need migrations and are not part of this phase.
