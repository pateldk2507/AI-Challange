import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "../src/validators/index.js";
import mp from "./fixtures/mpf023-valid.js";
import qs from "./fixtures/qsf049-valid.js";
import lot from "./fixtures/lotlog-valid.js";

test("valid MP-F-023 passes", () => assert.equal(validateDocument(mp).status, "PASS"));
test("valid QS-F-049 passes", () => assert.equal(validateDocument(qs).status, "PASS"));
test("valid Lot Log passes", () => assert.equal(validateDocument(lot).status, "PASS"));

test("QS-F-049 rejects non-MM/DD/YY date", () => {
  const copy = structuredClone(qs); copy.pages[0].reviewRows[0].technical.date = "9/27/24";
  const result = validateDocument(copy);
  assert.equal(result.status, "FAIL");
  assert.match(result.issues[0].message, /MM\/DD\/YY/);
});

test("QS-F-049 requires status when INC number exists", () => {
  const copy = structuredClone(qs); copy.pages[0].item10.status = "";
  const result = validateDocument(copy);
  assert.equal(result.status, "FAIL");
  assert.match(result.issues.at(-1).message, /Status/);
});

test("Lot Log reports missing manufacturer", () => {
  const copy = structuredClone(lot); copy.pages[0].lotItems[0].manufacturer = "";
  const result = validateDocument(copy);
  assert.equal(result.status, "FAIL");
  assert.equal(result.issues[0].field, "Process Pack");
  assert.match(result.issues[0].message, /Manufacturer/);
});

test("Lot Log requires RH for both processing and packaging", () => {
  const copy = structuredClone(lot);
  copy.pages[0].topFields = [];
  const result = validateDocument(copy);
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.issues.map(x => x.field), ["Processing Room RH", "Packaging Room RH"]);
});

test("Lot Log groups all missing fields for one item, retaining separate repeated items", () => {
  const copy = structuredClone(lot);
  copy.pages[1].sterilizationItems = [
    { item:"BS Upper Section", rowId:"left-6", loadNumber:"", sterilizationDate:"", confidence:.99 },
    { item:"Small Round Basin", rowId:"right-1", loadNumber:"", sterilizationDate:"N/A", confidence:.99 },
    { item:"Small Round Basin", rowId:"right-2", loadNumber:"0", sterilizationDate:"", confidence:.99 }
  ];
  const result = validateDocument(copy);
  assert.equal(result.errorCount, 3);
  assert.equal(result.issues[0].field, "BS Upper Section");
  assert.equal(result.issues[0].details.length, 2);
  assert.match(result.issues[0].message, /Load # is blank/);
  assert.match(result.issues[0].message, /Sterilization Date is blank/);
  assert.deepEqual(result.issues.slice(1).map(x => x.rowId), ["right-1", "right-2"]);
});

test("Lot Log groups missing Lot and Qty without hiding a manual review", () => {
  const copy = structuredClone(lot);
  copy.pages[1].packagingItems[0] = { item:"8x18", lot:"", qtyUsed:"", confidence:.99, fieldConfidence:{qtyUsed:.3} };
  const result = validateDocument(copy);
  assert.equal(result.status, "FAIL");
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].details.map(x => x.severity), ["error", "manual_review"]);
});

test("MP-F-023 groups missing initials/date and missing production values", () => {
  const copy = structuredClone(mp);
  const field = copy.pages[0].topFields.find(x => x.label === "Clean Room Log Review By / Date");
  field.initials = ""; field.date = ""; field.hasVisibleMark = false;
  copy.pages[0].productRows[0].produced = "";
  copy.pages[0].productRows[0].packaged = "";
  const result = validateDocument(copy);
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].details.length, 2);
  assert.equal(result.issues[1].field, "Posterior Tibialis");
  assert.match(result.issues[1].message, /# Produced is blank.*# Packaged is blank/);
});

test("QS-F-049 accepts a clearly handwritten date mark when OCR cannot transcribe it", () => {
  const copy = structuredClone(qs);
  const cell = copy.pages[0].reviewRows[9].quality;
  cell.date = "MARK";
  cell.hasDateMark = true;
  cell.dateConfidence = 0;
  const result = validateDocument(copy);
  assert.equal(result.status, "PASS");
  assert.equal(result.issues.length, 0);
});
