import { hasValue } from "../utils/date.js";
import { issue, manualReview, lowConfidence, combineRowIssues } from "./common.js";

function required(issues, page, section, item, field, value, confidence) {
  if (hasValue(value)) return;
  const fieldName = `${item} – ${field}`;
  if (lowConfidence(confidence)) {
    issues.push(manualReview(page, section, fieldName, `${field} could not be read confidently.`));
  } else {
    issues.push(issue(page, section, fieldName, `${field} is blank. A filled value is required; N/A is also accepted when applicable.`));
  }
}

function requiredRow(issues, page, section, row, fields) {
  const missing = [];
  for (const [key, label] of fields) {
    required(missing, page, section, row.item, label, row[key], row.fieldConfidence?.[key] ?? row.confidence);
  }
  const combined = combineRowIssues(missing, row.item, { rowId: row.rowId, location: row.location, itemImage: row.itemImage });
  if (combined) issues.push(combined);
}

export function validateLotLog(document) {
  const issues = [];
  for (const page of document.pages || []) {
    if (page.page === 1) {
      for (const label of ["Processing Room RH", "Packaging Room RH"]) {
        const field = (page.topFields || []).find(x => x.label === label);
        if (!hasValue(field?.value)) {
          issues.push(field?.hasVisibleMark && lowConfidence(field.confidence)
            ? manualReview(page.page, "Room Conditions", label, "RH could not be read confidently.")
            : issue(page.page, "Room Conditions", label, "RH is blank. A filled value is required."));
        }
      }
      for (const row of page.lotItems || []) {
        requiredRow(issues, page.page, "Item", row, [["lotNumber", "Lot Number"], ["expirationDate", "Exp. Date"], ["manufacturer", "Manufacturer"]]);
      }
      for (const row of page.regenMedItems || []) {
        requiredRow(issues, page.page, "RegenMed Item", row, [["lot", "Lot"], ["qtyUsed", "Qty Used"]]);
      }
    }

    if (page.page === 2) {
      for (const row of page.sterilizationItems || []) {
        requiredRow(issues, page.page, "Item", row, [["loadNumber", "Load #"], ["sterilizationDate", "Sterilization Date"]]);
      }
      for (const row of page.packagingItems || []) {
        requiredRow(issues, page.page, "Packaging", row, [["lot", "Lot"], ["qtyUsed", "Qty Used"]]);
      }
    }
  }
  return issues;
}
