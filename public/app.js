const form = document.querySelector("#uploadForm");
const input = document.querySelector("#fileInput");
const dropzone = document.querySelector("#dropzone");
const label = document.querySelector("#fileLabel");
const button = document.querySelector("#analyzeBtn");
const progress = document.querySelector("#progress");
const results = document.querySelector("#results");
const textSizeButton = document.querySelector("#textSizeBtn");
const evidenceDialog = document.querySelector("#evidenceDialog");
let evidenceImages = [];

function setLargeText(enabled) {
  document.body.classList.toggle("large-text", enabled);
  textSizeButton.setAttribute("aria-pressed", String(enabled));
  textSizeButton.textContent = enabled ? "Standard text" : "Larger text";
  try { localStorage.setItem("form-qc-large-text", String(enabled)); } catch {}
}
try { setLargeText(localStorage.getItem("form-qc-large-text") === "true"); } catch {}
textSizeButton.addEventListener("click", () => setLargeText(textSizeButton.getAttribute("aria-pressed") !== "true"));
document.querySelector("#closeEvidenceBtn").addEventListener("click", () => evidenceDialog.close());
results.addEventListener("click", e => {
  const trigger = e.target.closest("button[data-evidence]");
  if (!trigger) return;
  const evidence = evidenceImages[Number(trigger.dataset.evidence)];
  if (!evidence) return;
  const image = document.querySelector("#evidenceImage");
  image.src = evidence.image;
  image.alt = evidence.label;
  document.querySelector("#evidenceCaption").textContent = evidence.label;
  evidenceDialog.showModal();
});

function selectFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    input.value = ""; button.disabled = true;
    label.textContent = "Please choose a PDF file.";
    return;
  }
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  label.textContent = file.name; button.disabled = false; results.classList.add("hidden");
}
input.addEventListener("change", () => selectFile(input.files[0]));
["dragenter","dragover"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave","drop"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", e => selectFile(e.dataTransfer.files[0]));

function esc(v="") { return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function evidenceMarkup(evidence, page) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(evidence?.image || "")) return "";
  const label = `Page ${page} — ${evidence.label || "Field image"}`;
  const id = evidenceImages.push({ image:evidence.image, label }) - 1;
  return `<figure class="evidence-card"><figcaption>Image from your PDF</figcaption><img class="evidence-preview" src="${evidence.image}" alt="${esc(label)}"><button type="button" class="secondary-button image-button" data-evidence="${id}" aria-label="${esc(`Enlarge image: ${label}`)}">Enlarge image</button></figure>`;
}
function render(data) {
  evidenceImages = [];
  const statusClass = `status-${String(data.status).toLowerCase()}`;
  const statusLabel = { PASS:"Passed", FAIL:"Needs attention", MANUAL_REVIEW:"Review needed" }[data.status] || "Needs attention";
  const formName = data.formType === "DISCARD_FORM" ? "Discard Form (MP-F-018)" : data.formType;
  const rows = (data.issues || []).map(i => {
    const messages = i.details?.length ? i.details : [i];
    const description = messages.map(d => `<div>${esc(d.message)}${d.severity === "manual_review" && i.severity !== "manual_review" ? " (Manual review)" : ""}</div>`).join("");
    const itemImage = i.itemImage ? evidenceMarkup({image:i.itemImage,label:i.field},i.page) : "";
    const screenshots = (i.evidence || []).map(e => evidenceMarkup(e,i.page)).join("");
    const type = i.severity === "manual_review" ? "Review needed" : i.needsReview ? "Error: check image" : "Error";
    return `<tr><td>${i.page}</td><td>${esc(i.section)}</td><td>${esc(i.field)}${itemImage}${i.location ? `<br><small>${esc(i.location)}</small>` : ""}</td><td><span class="badge ${i.severity === "manual_review" ? "manual_review" : "error"}">${type}</span></td><td>${description}${screenshots}</td></tr>`;
  }).join("");
  results.innerHTML = `<section class="card"><div class="summary">
    <div class="metric"><span>Detected form</span><strong>${esc(formName)}</strong></div>
    <div class="metric"><span>Result</span><strong class="${statusClass}">${esc(statusLabel)}</strong></div>
    <div class="metric"><span>Rows to check</span><strong>${data.issueCount}</strong></div>
  </div>
  <div class="results-heading"><h2>Validation results</h2><p>${esc(data.filename || "")}</p></div>
  ${data.status === "PASS" ? `<div class="success">No issues were found in the checked fields.</div>` : `<p class="results-help">Check each row below. Where an image is shown, choose <strong>Enlarge image</strong> to see the original writing more clearly.</p><div class="table-wrap" role="region" aria-label="Fields to check" tabindex="0"><table><thead><tr><th scope="col">Page</th><th scope="col">Section</th><th scope="col">Field / Item</th><th scope="col">Result</th><th scope="col">What to check</th></tr></thead><tbody>${rows}</tbody></table></div>`}
  </section>`;
  results.classList.remove("hidden");
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!input.files[0]) return;
  button.disabled = true; input.disabled = true; button.textContent = "Checking…";
  form.setAttribute("aria-busy", "true"); progress.classList.remove("hidden"); results.classList.add("hidden");
  try {
    const body = new FormData(); body.append("pdf", input.files[0]);
    const response = await fetch("/api/analyze", { method:"POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed.");
    if(data.status === "MANUAL_REVIEW" ) {
      results.innerHTML = `<section class="card"><div class="errorbox" role="alert">The form could not be automatically validated. Please review the form manually.</div></section>`;
    }
    render(data);
    results.focus({ preventScroll:true });
    results.scrollIntoView({ behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start" });
  } catch (err) {
    results.innerHTML = `<section class="card"><div class="errorbox" role="alert">${esc(err.message)} Please try again.</div></section>`;
    results.classList.remove("hidden");
  } finally {
    progress.classList.add("hidden"); button.disabled = false; input.disabled = false;
    button.textContent = "2. Check form"; form.setAttribute("aria-busy", "false");
  }
});
