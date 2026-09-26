# Form QC – Local/Offline Edition

A Node.js web application that validates the required fields in MP-F-023, QS-F-049, MS Processing & Packaging Lot Logs, and MP-F-018 Tissue Discard Forms **without calling OpenAI, Gemini, or any other paid API**.

## How it works

1. Node/Express accepts one PDF.
2. `pdftoppm` renders pages locally.
3. Tesseract OCR identifies the form and reads printed/legible text.
4. OpenCV checks required handwritten/table cells for visible marks and normalizes rotated/scanned Lot Log pages.
5. JavaScript validators produce PASS, FAIL, or MANUAL_REVIEW.

No PDF is sent to a third party.

## Important limitation

Traditional OCR is not perfect on handwriting. When a required handwritten field contains a mark but the exact date cannot be confidently verified, the app returns **MANUAL_REVIEW** rather than incorrectly claiming PASS. This is intentional.

## Requirements

- Node.js 20+
- Python 3
- OpenCV for Python (`cv2`)
- Tesseract OCR
- Poppler (`pdftoppm`)

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y python3 python3-opencv tesseract-ocr poppler-utils
```

## Run locally

```bash
npm install
cp .env.example .env
npm test
npm start
```

Open `http://localhost:3000`.

## Docker

The included Dockerfile installs all local OCR dependencies:

```bash
docker build -t form-qc-local .
docker run --rm -p 3000:3000 form-qc-local
```

## Deployment

`render.yaml` is included for Render. Because this edition uses system packages, deploy using the Docker runtime.

## Privacy

Uploaded PDFs are written only to a random temporary directory during processing and deleted immediately after analysis.

## Files of interest

- `src/extractors/localExtractor.js` – Node ↔ local Python bridge
- `src/local/analyze_pdf.py` – PDF rendering, OCR, image/ink analysis, form extraction
- `src/validators/` – deterministic compliance rules

## Adding new form revisions

The local analyzer uses normalized page geometry plus printed labels. If a future revision changes the form layout substantially, add a new geometry profile in `src/local/analyze_pdf.py` rather than changing the validation rules.


## Current test coverage

The deterministic validator unit suite covers valid MP-F-023, QS-F-049 and Lot Log fixtures, strict QS date checks, INC#/Status dependency, and missing Lot Log manufacturer. The `tests/integration-samples` directory also contains the additional scanned PDFs supplied for local regression testing.

Because the offline edition uses traditional OCR, scan alignment and handwriting quality can affect extraction. Keep `MANUAL_REVIEW` available for ambiguous handwriting rather than silently passing unreadable content.

## Table extraction improvements (v3)

This build fixes a major local-extraction issue in the Lot Log tables. Previous cell rectangles overlapped neighbouring columns and several row centers were offset, which could make a blank field appear populated. The v3 extractor uses non-overlapping cell regions aligned to the actual table grid and presence-based validation for Lot Log values (OCR is no longer trusted to decide whether a required Lot/Date/Manufacturer/Load/Qty cell is populated). This substantially improves detection of removed or blank handwriting.

## v4 Lot Log table fixes

This build normalizes Lot Log pages by the actual form-content bounding box before reading table cells. This handles both normal portrait scans and PDFs where the same form is placed on a landscape canvas. Table columns were recalibrated from the real grid, and handwritten single-stroke values such as `1` are preserved rather than removed as table lines.

The completed reference Lot Log is included in the automated end-to-end tests and must return `PASS`. The missing-fields sample must return `FAIL` for the actual missing field without reporting populated Manufacturer, Qty Used, or Load # cells as blank.

## Missing-field and report fixes

MP-F-023 scans are straightened before validation. Both donor verification boxes are checked, Operations Manager Review excludes its printed label, and production cells follow the detected table lines. Lot Logs check Processing and Packaging Room RH separately. Page-two rows follow their actual borders, including the final item rows.

The report combines all missing fields for one physical item row. Printed item names replace generic left/right row labels; repeated names on different rows stay separate. Handwritten item names are shown as a crop from the submitted PDF to avoid presenting unreliable OCR text as an exact transcription. These crops are returned with the report and are not saved by the server.

`npm test` includes regressions for the supplied 25017 MP-F-023 and 2142 Lot Log, alongside completed reference forms. It requires the local Python/OpenCV/Tesseract/Poppler dependencies (or the Docker image).

## Discard Form (MP-F-018)

Every page is validated independently. Donor #, Reason for Discard, authorization initials/date, and all seven bottom sign-off fields must be completed. Exactly one Tissue Status must be selected. Actual Graft IDs require a packaged-tissue status; N/A and handwritten dashes require Unprocessed Tissue or In Processing Tissue. Every listed tissue requires its final X confirmation. Unused tissue rows are ignored, and explicit N/A is accepted in bottom fields.

The shared date check accepts real dates in both `MM/DD/YY` and `MM-DD-YY`, with consistent separators. Existing presence-based MP-F-023 and Lot Log date checks continue to accept these formats. Discard dates that cannot be read reliably require manual review; they are not reported as blank. Tissue-name crops preserve the original handwriting in the report.

The tests cover the three-page Discard sample, deliberately cleared fields and X boxes, checkbox selection, Graft ID/status combinations, dashes as N/A, and both date separators. The upload bar is compact, and the wider results table has a fixed header while scrolling.

## QS-F-049 handwritten date handling

Handwritten review dates that are visibly present but cannot be transcribed confidently by local OCR are treated as populated and no longer generate a `Date could not be read confidently` warning. If OCR does produce a date string, its date format is still validated.
