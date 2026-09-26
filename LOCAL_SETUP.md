# Local / No-Paid-API setup

This edition does not call OpenAI, Gemini, or another hosted AI API.

## Runtime pipeline
PDF -> Poppler (`pdftoppm`) -> OpenCV/Tesseract -> structured extraction -> JavaScript validation.

## Ubuntu / Debian
```bash
sudo apt update
sudo apt install -y python3 python3-opencv tesseract-ocr poppler-utils
npm install
npm test
npm start
```

Open http://localhost:3000.

## Docker (recommended)
```bash
docker build -t form-qc-local .
docker run --rm -p 3000:3000 form-qc-local
```

## Render
Push this folder to GitHub and create a Render service from `render.yaml`. It uses the Dockerfile so system OCR dependencies are installed automatically.

## Notes
- No API key is needed.
- Uploaded PDFs are placed in a random temporary folder only while being analyzed and are deleted after processing.
- Printed text and blank/nonblank checks work locally. Handwritten OCR is inherently less reliable than a large vision model; the code therefore prefers deterministic ink-presence checks for many handwritten fields.
