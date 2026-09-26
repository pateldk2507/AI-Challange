import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdf } from "./extractors/localExtractor.js";
import { validateDocument } from "./validators/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const maxFileMb = Number(process.env.MAX_FILE_MB || 20);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: maxFileMb * 1024 * 1024 }
});

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, engine: "local-tesseract-opencv", paidApiRequired: false });
});

app.post("/api/analyze", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload one PDF file." });
    const looksLikePdf = req.file.mimetype === "application/pdf" && req.file.buffer.subarray(0, 5).toString() === "%PDF-";
    if (!looksLikePdf) return res.status(400).json({ error: "Only valid PDF files are accepted." });

    const extraction = await extractPdf(req.file.buffer, req.file.originalname);
    if ((extraction.classificationConfidence ?? 0) < 0.6) extraction.formType = "UNKNOWN";
    const validation = validateDocument(extraction);

    res.json({
      filename: req.file.originalname,
      formType: extraction.formType,
      classificationConfidence: extraction.classificationConfidence,
      status: validation.status,
      issueCount: validation.issues.length,
      errorCount: validation.errorCount,
      manualReviewCount: validation.manualReviewCount,
      issues: validation.issues,
      warnings: extraction.warnings || []
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Unable to analyze this PDF." });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `PDF is too large. Maximum size is ${maxFileMb} MB.` });
  }
  console.error(error);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Form QC running on http://localhost:${port}`);
});
