import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument } from '../src/validators/index.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const pdf=path.join(here,'integration-samples','Discard-22043.pdf');
function python(script,...args) {
  const result=spawnSync(process.env.PYTHON_BIN || 'python3',[script,...args],{encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

test('Discard PDF: identifies all pages, checks 11 tissues and accepts handwritten dashes as N/A',()=>{
  const doc=python(path.join(here,'../src/local/analyze_pdf.py'),pdf);
  assert.equal(doc.formType,'DISCARD_FORM');
  assert.equal(doc.pages.length,3);
  assert.deepEqual(doc.pages.map(x=>x.discard.tissues.length),[1,9,1]);
  assert.deepEqual(doc.pages.map(x=>x.discard.tissueStatuses.find(s=>s.checked).label),[
    'In Processing Tissue','Unprocessed Tissue','Unprocessed Tissue'
  ]);
  for(const page of doc.pages) {
    assert.equal(page.discard.layoutDetected,true);
    assert.equal(page.discard.tissuesDetected,true);
    assert.ok(page.discard.tissues.every(x=>x.confirmed));
    assert.ok(page.discard.bottomFields.every(x=>x.value));
  }
  assert.ok(doc.pages[1].discard.tissues.every(x=>x.graftIdKind==='dash'));
  const result=validateDocument(doc);
  assert.equal(result.errorCount,0,JSON.stringify(result.issues));
  assert.ok(result.issues.every(x=>x.section==='Top of Form' || x.section==='Bottom of Form'));
});

test('Discard image reader detects erased fields/X/status and real Graft IDs',()=>{
  const cases=python(path.join(here,'discard-image-cases.py'),pdf);
  const result=validateDocument(cases.blank);
  assert.equal(result.status,'FAIL');
  assert.equal(result.issues.filter(x=>x.section==='Bottom of Form' && x.severity==='error').length,7);
  assert.ok(result.issues.some(x=>x.field==='Donor #' && x.severity==='error'));
  assert.ok(result.issues.some(x=>x.field==='Reason for Discard' && x.severity==='error'));
  const auth=result.issues.find(x=>x.field==='Discard Authorized By / Date');
  assert.equal(auth.details.length,2);
  assert.ok(result.issues.some(x=>x.section==='Tissue Status' && x.severity==='error'));
  assert.ok(result.issues.some(x=>x.rowId==='tissue-1' && /X confirmation box is blank/.test(x.message)));

  const d=cases.packaged.pages[0].discard;
  assert.equal(d.tissueStatuses.find(x=>x.checked).label,'Released Packaged Tissue');
  assert.equal(d.tissues[0].graftIdKind,'id');
  assert.ok(!validateDocument(cases.packaged).issues.some(x=>x.section==='Tissues'));
  assert.match(validateDocument(cases.missingDate).issues.find(x=>x.field==='Discard Authorized By / Date').message,/Authorization date is blank/);
  assert.match(validateDocument(cases.missingInitials).issues.find(x=>x.field==='Discard Authorized By / Date').message,/Authorization initials is blank/);
});
