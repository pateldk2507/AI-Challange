export function issue(page, section, field, message, value = "", severity = "error") {
  return { page, section, field, value, severity, message };
}

export function manualReview(page, section, field, message, value = "") {
  return issue(page, section, field, message, value, "manual_review");
}

export function lowConfidence(confidence, threshold = 0.65) {
  return typeof confidence === "number" && confidence < threshold;
}

export function combineRowIssues(issues, field, metadata = {}) {
  if (!issues.length) return null;
  return {
    ...issues[0], ...metadata, field,
    severity: issues.some(x => x.severity === "error") ? "error" : "manual_review",
    message: [...new Set(issues.map(x => x.message))].join(" "),
    details: issues.map(({ field, message, severity }) => ({ field, message, severity }))
  };
}
