import { hasValue } from "../utils/date.js";
import { issue, manualReview, lowConfidence, combineRowIssues } from "./common.js";

const EXPECTED_TOP = [
  "Donor # Verified By", "Cross Reference #", "Donor Sex", "Donor Age", "Date of Recovery",
  "Instruction Verification", "Date of Processing", "Clean Room Log Review By / Date", "Tissue Checked In By / Date"
];

function norm(s="") { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

export function validateMpf023(document) {
  const issues = [];
  const page = document.pages.find(p => p.page === 1) || document.pages[0];
  if (!page) return [issue(1, "Document", "Page 1", "Page 1 could not be read.")];

  for (const expected of EXPECTED_TOP) {
    const field = (page.topFields || []).find(x => norm(x.label) === norm(expected));
    if (!field) {
      issues.push(issue(page.page, "Top of Form", expected, "Required field could not be located or is blank."));
      continue;
    }
    if (field.requiredParts?.length) {
      for (const part of field.requiredParts) {
        if (!hasValue(part.value)) issues.push(issue(page.page, "Top of Form", field.label, `${part.label} are missing.`));
      }
    } else if (field.kind === "by_date") {
      if (lowConfidence(field.confidence) && field.hasVisibleMark && (!hasValue(field.initials) || !hasValue(field.date))) {
        issues.push(manualReview(page.page, "Top of Form", field.label, "Handwriting is present but initials/date could not be read confidently."));
        continue;
      }
      if (!hasValue(field.initials)) issues.push(issue(page.page, "Top of Form", field.label, "Initials are missing."));
      if (!hasValue(field.date)) issues.push(issue(page.page, "Top of Form", field.label, "Date is missing."));
    } else if (!hasValue(field.value)) {
      if (lowConfidence(field.confidence) && field.hasVisibleMark) issues.push(manualReview(page.page, "Top of Form", field.label, "A value appears to be present but could not be read confidently."));
      else issues.push(issue(page.page, "Top of Form", field.label, "Required field is blank."));
    }
  }

  const om = page.operationsManagerReview;
  if (!om?.present || (!hasValue(om.initials) && !hasValue(om.date))) {
    issues.push(om?.hasVisibleMark && lowConfidence(om.confidence)
      ? manualReview(page.page, "Operations Manager Review", "Initials / Date", "Review appears to contain handwriting but could not be read confidently.")
      : issue(page.page, "Operations Manager Review", "Initials / Date", "Operations Manager Review is incomplete. Initials and date are required."));
  } else {
    if (!hasValue(om.initials)) issues.push(issue(page.page, "Operations Manager Review", "Initials", "Operations Manager initials are missing."));
    if (!hasValue(om.date)) issues.push(issue(page.page, "Operations Manager Review", "Date", "Operations Manager review date is missing."));
  }

  if (!(page.productRows || []).length) issues.push(issue(page.page, "# Produced / # Packaged", "Processing table", "Processing rows could not be located."));
  for (const row of page.productRows || []) {
    if (row.producedApplicable && !hasValue(row.produced)) issues.push(lowConfidence(row.confidence)
      ? manualReview(page.page, "# Produced / # Packaged", `${row.item} – # Produced`, "# Produced could not be read confidently.")
      : issue(page.page, "# Produced / # Packaged", `${row.item} – # Produced`, "# Produced is blank."));
    if (row.packagedApplicable && !hasValue(row.packaged)) issues.push(lowConfidence(row.confidence)
      ? manualReview(page.page, "# Produced / # Packaged", `${row.item} – # Packaged`, "# Packaged could not be read confidently.")
      : issue(page.page, "# Produced / # Packaged", `${row.item} – # Packaged`, "# Packaged is blank."));
  }
  const groups = new Map();
  for (const entry of issues) {
    const field = entry.section === "# Produced / # Packaged" ? entry.field.split(" – ")[0]
      : entry.section === "Operations Manager Review" ? "Initials / Date" : entry.field;
    const key = JSON.stringify([entry.page, entry.section, field]);
    if (!groups.has(key)) groups.set(key, { field, entries: [] });
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()].map(({ entries, field }) => combineRowIssues(entries, field));
}
