import { hasValue, isStrictMmDdYy } from "../utils/date.js";
import { issue, lowConfidence, combineRowIssues } from "./common.js";

function flag(page, section, field, message, image, needsReview = false, value = "") {
  return { ...issue(page, section, field, message, value), needsReview,
    evidence: image ? [{ label: field, image }] : [] };
}

function validateReviewCell(issues, page, row, column, cell) {
  const field = `${column} – Item ${row.item}`;
  const section = "Reviewed By/Date";
  const findings = [];
  const add = (message, image = cell?.reviewImage, needsReview = false, value = "") =>
    findings.push(flag(page, section, field, message, image, needsReview, value));

  if (cell?.isNA) {
    if (lowConfidence(cell.confidence)) add("The N/A entry could not be read confidently. Check the image.", cell.reviewImage, true);
  } else if (!hasValue(cell?.initials) && !hasValue(cell?.date) && !cell?.hasVisibleMark) {
    add("Entry is not filled in. Enter initials and date, or N/A.");
  } else {
    const initialsConfidence = cell?.initialsConfidence ?? cell?.confidence;
    if (!hasValue(cell?.initials)) {
      const uncertain = !!cell?.hasInitialsMark || (!!cell?.hasVisibleMark && lowConfidence(initialsConfidence));
      add(uncertain ? "Initials could not be read confidently. Check the image." : "Initials are missing.", cell?.reviewImage, uncertain);
    } else if (lowConfidence(initialsConfidence)) {
      add("Initials could not be read confidently. Check the image.", cell?.reviewImage, true);
    }

    const dateConfidence = cell?.dateConfidence ?? cell?.confidence;
    if (!hasValue(cell?.date) && !cell?.hasDateMark) {
      add("Date is missing.", cell?.dateImage || cell?.reviewImage);
    } else if (cell?.date === "MARK" || lowConfidence(dateConfidence, 0.85) || !hasValue(cell?.date)) {
      add("Date could not be read confidently. Check the image; MM/DD/YY and MM-DD-YY are both accepted.",
        cell?.dateImage || cell?.reviewImage, true);
    } else if (!isStrictMmDdYy(cell.date)) {
      add("Date must be a real date in MM/DD/YY or MM-DD-YY format.", cell?.dateImage || cell?.reviewImage, false, cell.date);
    }
  }
  const grouped = combineRowIssues(findings, field);
  if (grouped) {
    grouped.needsReview = findings.some(x => x.needsReview);
    grouped.evidence = [...new Map(findings.flatMap(x => x.evidence).map(x => [x.image, x])).values()];
    issues.push(grouped);
  }
}

export function validateQsf049(document) {
  const issues = [];
  if (!document.pages?.length) return [issue(1, "Document", "QS-F-049", "The review form could not be read.")];
  for (const page of document.pages) {
    const byItem = new Map((page.reviewRows || []).map(r => [String(r.item), r]));
    for (let i = 1; i <= 10; i++) {
      const row = byItem.get(String(i));
      if (!row) {
        issues.push(flag(page.page, "Reviewed By/Date", `Item ${i}`, "Required review row could not be found. Check the image.", page.reviewImage, true));
        continue;
      }
      validateReviewCell(issues, page.page, row, "Technical", row.technical);
      validateReviewCell(issues, page.page, row, "Quality", row.quality);
    }

    const status = page.item10;
    const section = "Technical and Quality Review Elements";
    const field = "Item 10 – Status";
    if (!status || status.statusFieldFound === false) {
      issues.push(flag(page.page, section, field, "Status is missing. The Status field could not be found in Item 10.", status?.statusImage || page.reviewImage));
    } else if (!hasValue(status.status) && !status.statusHasVisibleMark) {
      issues.push(flag(page.page, section, field, "Status is not filled in.", status.statusImage));
    } else if (!hasValue(status.status) || status.status === "MARK" || lowConfidence(status.statusConfidence ?? status.confidence)) {
      issues.push(flag(page.page, section, field, "Status contains writing but could not be read confidently. Check the image.", status.statusImage, true));
    }
  }
  return issues;
}
