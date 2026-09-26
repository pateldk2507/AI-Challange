import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument } from '../src/validators/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const analyzer = path.join(root, 'src', 'local', 'analyze_pdf.py');

function analyze(pdf) {
  const r = spawnSync(process.env.PYTHON_BIN || 'python3', [analyzer, pdf], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr || 'local analyzer failed');
  return JSON.parse(r.stdout);
}

test('local extractor: completed Lot Log passes end-to-end', () => {
  const pdf = path.join(root, 'samples', 'lot-log-valid.pdf');
  const result = validateDocument(analyze(pdf));
  assert.equal(result.status, 'PASS');
  assert.equal(result.issues.length, 0);
});

test('local extractor: missing Lot Log field is detected without false table blanks', () => {
  const pdf = path.join(root, 'tests', 'integration-samples', 'Lot-Log_missing_fields.pdf');
  const result = validateDocument(analyze(pdf));
  assert.equal(result.status, 'FAIL');
  assert.ok(result.issues.some(x => x.field === 'Poly Bags' && /Lot is blank/.test(x.message)));
  assert.ok(!result.issues.some(x => x.field === 'Labels' && /Qty Used/.test(x.message)));
  assert.ok(!result.issues.some(x => x.page === 2 && x.section === 'Item'));
});

test('local extractor: completed MP-F-023 detects both By/Date fields', () => {
  const pdf = path.join(root, 'samples', 'MP-F-023-valid.pdf');
  const doc = analyze(pdf);
  const page = doc.pages[0];
  const clean = page.topFields.find(x => x.label === 'Clean Room Log Review By / Date');
  const tissue = page.topFields.find(x => x.label === 'Tissue Checked In By / Date');
  assert.ok(clean?.initials, 'Clean Room Log initials should be detected');
  assert.ok(clean?.date, 'Clean Room Log date should be detected');
  assert.ok(tissue?.initials, 'Tissue Checked In initials should be detected');
  assert.ok(tissue?.date, 'Tissue Checked In date should be detected');
  const result = validateDocument(doc);
  assert.equal(result.status, 'PASS');
  assert.equal(result.issues.length, 0);
});

test('local extractor: blank Tissue Checked In By/Date still fails', () => {
  const pdf = path.join(root, 'tests', 'integration-samples', 'Test1.pdf');
  const result = validateDocument(analyze(pdf));
  assert.equal(result.status, 'FAIL');
  const tissue = result.issues.filter(x => x.field === 'Tissue Checked In By / Date');
  assert.equal(tissue.length, 1);
  assert.match(tissue[0].message, /Initials are missing/);
  assert.match(tissue[0].message, /Date is missing/);
});

test('25017 MP-F-023: finds review, verification and product blanks as well as Clean Room', () => {
  const result = validateDocument(analyze(path.join(here, 'integration-samples', '25017 MP-F-023.pdf')));
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.issues.map(x => x.field), [
    'Donor # Verified By', 'Clean Room Log Review By / Date', 'Initials / Date',
    'Posterior Tibialis', 'Femoral Head', 'Humeral Head'
  ]);
  assert.match(result.issues[1].message, /Initials are missing.*Date is missing/);
  assert.match(result.issues[3].message, /# Produced is blank/);
  assert.match(result.issues[4].message, /# Packaged is blank/);
});

test('2142 Lot Log: RH blanks are detected without shifted page-two cells or unused packaging rows', () => {
  const doc = analyze(path.join(here, 'integration-samples', '2142-635946 lot log.pdf'));
  const result = validateDocument(doc);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.issues.filter(x => x.section === 'Room Conditions').map(x => x.field), [
    'Processing Room RH', 'Packaging Room RH'
  ]);
  assert.ok(!result.issues.some(x => x.page === 2 && x.section === 'Item'));
  const packaging = result.issues.filter(x => x.page === 2 && x.section === 'Packaging');
  assert.equal(packaging.length, 1);
  assert.equal(packaging[0].rowId, 'packaging-3');
  assert.match(packaging[0].message, /Lot is blank/);
  assert.doesNotMatch(packaging[0].message, /Qty Used/);
  assert.match(packaging[0].itemImage, /^data:image\/png;base64,/);
  assert.equal(doc.pages[1].sterilizationItems.find(x => x.rowId === 'left-6').item, 'BS Upper Section');
  assert.equal(doc.pages[1].sterilizationItems.find(x => x.rowId === 'left-45').item, 'Small Round Basin');
});
