import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../src/validators/index.js';
import { isStrictMmDdYy } from '../src/utils/date.js';
import discard from './fixtures/discard-valid.js';
import qs from './fixtures/qsf049-valid.js';
import mp from './fixtures/mpf023-valid.js';
import lot from './fixtures/lotlog-valid.js';

const copy = () => structuredClone(discard);
test('completed Discard Form passes with explicit bottom N/A values', () => {
  assert.equal(validateDocument(discard).status,'PASS');
});

test('Discard requires donor, reason, authorization initials and date, and every bottom field', () => {
  const doc=copy(), d=doc.pages[0].discard;
  for(const f of [d.donorNumber,d.reason,d.authorization.initials,d.authorization.date,...d.bottomFields]) {
    f.value='';f.hasVisibleMark=false;
  }
  const result=validateDocument(doc);
  assert.equal(result.status,'FAIL');
  assert.equal(result.issues.filter(x=>x.section==='Bottom of Form').length,7);
  const auth=result.issues.filter(x=>x.field==='Discard Authorized By / Date');
  assert.equal(auth.length,1);
  assert.equal(auth[0].details.length,2);
  assert.ok(result.issues.some(x=>x.field==='Donor #'));
  assert.ok(result.issues.some(x=>x.field==='Reason for Discard'));
});

test('Discard requires exactly one Tissue Status', () => {
  for(const checked of [false,true]) {
    const doc=copy();doc.pages[0].discard.tissueStatuses.forEach(x=>x.checked=checked);
    const result=validateDocument(doc);
    assert.equal(result.status,'FAIL');
    assert.match(result.issues.find(x=>x.section==='Tissue Status').message,/one/i);
  }
});

test('Discard enforces the Graft ID/status combinations, including dashes as N/A', () => {
  for(const kind of ['id','na','dash']) for(let status=0;status<4;status++) {
    const doc=copy(),d=doc.pages[0].discard;
    d.tissueStatuses.forEach((x,i)=>x.checked=i===status);
    d.tissues[0].graftIdKind=kind;
    d.tissues[0].graftId=kind==='id'?'22043-001':kind==='dash'?'-':'N/A';
    const expected=(kind==='id'?status>=2:status<2)?'PASS':'FAIL';
    assert.equal(validateDocument(doc).status,expected,`${kind} with status ${status}`);
  }
});

test('Discard validates every page and groups missing X with status mismatch for the tissue', () => {
  const doc=copy();doc.pages.push(structuredClone(doc.pages[0]));doc.pages[1].page=2;
  const tissue=doc.pages[1].discard.tissues[0];
  tissue.confirmed=false;tissue.graftIdKind='id';tissue.graftId='22043-001';
  const result=validateDocument(doc);
  assert.equal(result.issues.length,1);
  assert.equal(result.issues[0].page,2);
  assert.equal(result.issues[0].field,'R&L Patellar');
  assert.equal(result.issues[0].details.length,2);
});

test('Discard ambiguous dates, IDs, checkboxes and missing layout require review', () => {
  for(const mutate of [
    d=>{d.authorization.date.value='MARK';d.authorization.date.confidence=.4;},
    d=>{d.tissues[0].graftIdKind='unknown';},
    d=>{d.tissueStatuses[0].confidence=.4;},
    d=>{d.layoutDetected=false;}
  ]) {
    const doc=copy();mutate(doc.pages[0].discard);
    assert.equal(validateDocument(doc).status,'MANUAL_REVIEW');
  }
});

test('date checker accepts both separators and rejects impossible dates and mixed separators', () => {
  for(const value of ['09/03/24','09-03-24','02/29/24','02-29-24']) assert.ok(isStrictMmDdYy(value),value);
  for(const value of ['02/29/25','02-30-24','09/03-24','9/03/24','09.03.24','09-03-2024']) assert.equal(isStrictMmDdYy(value),false,value);
});

test('slash and hyphen dates are accepted across all four form validators', () => {
  for(const date of ['09/03/24','09-03-24']) {
    const docs=[structuredClone(qs),structuredClone(mp),structuredClone(lot),copy()];
    docs[0].pages[0].reviewRows[0].technical.date=date;
    docs[1].pages[0].operationsManagerReview.date=date;
    docs[1].pages[0].topFields.find(x=>x.label==='Clean Room Log Review By / Date').date=date;
    docs[2].pages[1].sterilizationItems[0].sterilizationDate=date;
    docs[3].pages[0].discard.authorization.date.value=date;
    docs[3].pages[0].discard.bottomFields.filter(x=>x.label.endsWith('Date')).forEach(x=>x.value=date);
    for(const doc of docs) assert.equal(validateDocument(doc).status,'PASS',`${doc.formType}: ${date}`);
  }
});

test('Discard rejects readable impossible authorization and bottom dates', () => {
  const doc=copy();doc.pages[0].discard.authorization.date.value='02-30-24';
  doc.pages[0].discard.bottomFields.find(x=>x.label==='Discard Date').value='02/29/25';
  assert.equal(validateDocument(doc).errorCount,2);
});
