import { hasValue, isNA, isStrictMmDdYy } from "../utils/date.js";
import { issue, manualReview, lowConfidence, combineRowIssues } from "./common.js";

const STATUSES = ["Unprocessed Tissue", "In Processing Tissue", "Unreleased Packaged Tissue", "Released Packaged Tissue"];
const BOTTOM_FIELDS = [
  "Tissue Discarded By", "Confirmed By", "Discard Date",
  "FreezerPro Updated By", "FreezerPro Updated Date",
  "Log / FreezerPro Updated By", "Log / FreezerPro Updated Date"
];

function required(issues, page, section, label, field, { date = false, allowNA = true } = {}) {
  const value = field?.value;
  if (!hasValue(value) || (!allowNA && isNA(value))) {
    issues.push(field?.hasVisibleMark && lowConfidence(field.confidence)
      ? manualReview(page, section, label, `${label} could not be read confidently.`)
      : issue(page, section, label, `${label} is blank.`));
  } else if (date && !(allowNA && isNA(value))) {
    if (value === "MARK" || lowConfidence(field.confidence)) {
      issues.push(manualReview(page, section, label, `${label} contains writing; confirm the date is MM/DD/YY or MM-DD-YY.`));
    } else if (!isStrictMmDdYy(value)) {
      issues.push(issue(page, section, label, `${label} must be a real date in MM/DD/YY or MM-DD-YY format.`, value));
    }
  }
}

export function validateDiscard(document) {
  const issues = [];
  if (!document.pages?.length) return [issue(1, "Document", "Discard Form", "No Discard Form pages could be read.")];
  for (const page of document.pages) {
    const data = page.discard || {};
    if (data.layoutDetected === false) {
      issues.push(manualReview(page.page, "Document", "Discard Form", "The Discard Form layout could not be located. Review this page manually."));
      continue;
    }
    required(issues, page.page, "Top of Form", "Donor #", data.donorNumber);
    required(issues, page.page, "Top of Form", "Reason for Discard", data.reason);
    const authorization = [];
    required(authorization, page.page, "Top of Form", "Authorization initials", data.authorization?.initials, { allowNA:false });
    required(authorization, page.page, "Top of Form", "Authorization date", data.authorization?.date, { date:true, allowNA:false });
    const grouped = combineRowIssues(authorization, "Discard Authorized By / Date");
    if (grouped) issues.push(grouped);

    const selections = (data.tissueStatuses || []).filter(x => x.checked);
    const uncertainStatus = (data.tissueStatuses || []).some(x => lowConfidence(x.confidence));
    const status = selections.length === 1 && STATUSES.includes(selections[0].label) ? selections[0].label : null;
    if (uncertainStatus) {
      issues.push(manualReview(page.page, "Tissue Status", "Tissue Status", "A checkbox mark is unclear. Confirm exactly one Tissue Status is selected."));
    } else if (!status) {
      issues.push(issue(page.page, "Tissue Status", "Tissue Status", selections.length > 1
        ? "More than one Tissue Status is checked. Select exactly one."
        : "Select one Tissue Status box."));
    }

    for (const row of data.tissues || []) {
      const rowIssues = [];
      if (!row.confirmed) rowIssues.push(lowConfidence(row.confirmationConfidence)
        ? manualReview(page.page, "Tissues", "X confirmation", "The X confirmation could not be read confidently.")
        : issue(page.page, "Tissues", "X confirmation", "The X confirmation box is blank for this listed tissue."));
      const extractedKind = row.graftIdKind || (isNA(row.graftId) ? "na" : /^\s*[-\u2013\u2014]+\s*$/.test(row.graftId || "") ? "dash" : hasValue(row.graftId) ? "id" : "blank");
      const kind = extractedKind === "dash" ? "na" : extractedKind;
      if (["unknown", "blank"].includes(kind)) {
        rowIssues.push(manualReview(page.page, "Tissues", "Graft ID", "Confirm whether the Graft ID is N/A or an actual ID so its Tissue Status can be checked."));
      } else if (status && !uncertainStatus) {
        if (kind === "id" && !STATUSES.slice(2).includes(status)) {
          rowIssues.push(issue(page.page, "Tissues", "Graft ID / Tissue Status", "A listed Graft ID requires Unreleased Packaged Tissue or Released Packaged Tissue."));
        }
        if (kind === "na" && !STATUSES.slice(0,2).includes(status)) {
          rowIssues.push(issue(page.page, "Tissues", "Graft ID / Tissue Status", "N/A Graft IDs require Unprocessed Tissue or In Processing Tissue."));
        }
      }
      const combined = combineRowIssues(rowIssues, row.item || "Listed tissue", { rowId:row.rowId, location:row.location, itemImage:row.itemImage });
      if (combined) issues.push(combined);
    }
    if (data.tissuesDetected === false) issues.push(manualReview(page.page, "Tissues", "Tissue list", "The tissue table could not be read. Confirm every listed tissue has an X."));

    for (const label of BOTTOM_FIELDS) {
      const field = (data.bottomFields || []).find(x => x.label === label);
      required(issues, page.page, "Bottom of Form", label, field, { date:label.endsWith("Date") });
    }
  }
  return issues;
}
