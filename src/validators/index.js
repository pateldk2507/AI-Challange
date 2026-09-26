import { validateMpf023 } from "./mpf023.js";
import { validateQsf049 } from "./qsf049.js";
import { validateLotLog } from "./lotLog.js";
import { validateDiscard } from "./discard.js";
import { issue } from "./common.js";

export function validateDocument(document) {
  if (!document || typeof document !== "object") {
    return { status: "FAIL", issues: [issue(1, "Document", "Extraction", "No extraction result was produced.")] };
  }

  let issues;
  switch (document.formType) {
    case "MP-F-023": issues = validateMpf023(document); break;
    case "QS-F-049": issues = validateQsf049(document); break;
    case "LOT_LOG": issues = validateLotLog(document); break;
    case "DISCARD_FORM": issues = validateDiscard(document); break;
    default:
      issues = [issue(1, "Document", "Form Type", "Unable to confidently identify this form type.")];
  }

  const manualReviewCount = issues.filter(x => x.severity === "manual_review").length;
  const errorCount = issues.filter(x => x.severity === "error").length;
  const status = errorCount > 0 ? "FAIL" : manualReviewCount > 0 ? "MANUAL_REVIEW" : "PASS";

  return { status, issues, errorCount, manualReviewCount };
}
