'use strict';
/*
 * sales_intake_form — pure form logic for the Kasper-gated Sales Intake tab.
 *
 * Run:  node test/sales-intake-form.js   (exit 0 = all good)
 *
 * BACKGROUND. Submitting the Sales Intake form kicks off the paperwork chain
 * (Supabase audit row → eSignatures agreement → ONE combined email with the
 * signing link + Stripe payment link). Getting the wrong Stripe link, a
 * zero-dollar invoice, or a blank termination clause into that chain means a
 * wrong contract in a client's inbox — so the link-selection, validation and
 * payload-shaping helpers are pure functions and asserted here against the
 * REAL shipping code (extracted by name, brace-balanced). Spec:
 * SALES_INTAKE_DESIGN.md.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const m = INDEX.match(new RegExp('const ' + name + ' = [\\s\\S]*?;\\r?\\n'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const src = [
  grabConst('SI_STRIPE_LINKS'),
  grabConst('SI_PRICES'),
  grabConst('SI_REGULAR_TERMINATION'),
  grabFunc('_siLinkChoiceForBilling'),
  grabFunc('_siAmountForBilling'),
  grabFunc('_siResolvePaymentLink'),
  grabFunc('_siValidate'),
  grabFunc('_siBuildSubmission'),
].join('\n');
// eslint-disable-next-line no-new-func
const api = new Function(src + `
  return { SI_STRIPE_LINKS, SI_PRICES, SI_REGULAR_TERMINATION,
    _siLinkChoiceForBilling, _siAmountForBilling, _siResolvePaymentLink,
    _siValidate, _siBuildSubmission };
`)();

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('✓  ' + name); }
  else { fail++; console.log('✗  ' + name + '  (got ' + JSON.stringify(got) + ')'); }
}

// A fully valid serialized form (quarterly deal, regular clause, fixed link).
function valid(over) {
  return Object.assign({
    client_name: 'Jane Doe', closed_by: 'Kasper', instagram: '@janedoe',
    client_email: 'jane@example.com', contract_start_date: '2026-07-02',
    deliverables: '12 short-form videos per 4-week period',
    billing_type: 'quarterly', invoice_amount: '7991',
    payment_link_choice: 'quarterly', payment_link_custom: '',
    termination_clause_type: 'regular', termination_clause_custom: '',
    referred_by: ''
  }, over || {});
}

// 1) Fixed Stripe links match the spec (SALES_INTAKE_DESIGN.md, Kasper 2026-07-02).
ok('monthly Stripe link is the 4-week URL',
  api.SI_STRIPE_LINKS.monthly === 'https://buy.stripe.com/00waEW0TI6Sb2Y1cl0ao80g', api.SI_STRIPE_LINKS.monthly);
ok('quarterly Stripe link is the 12-week URL',
  api.SI_STRIPE_LINKS.quarterly === 'https://buy.stripe.com/28E00i6e2ekD569dp4ao80q', api.SI_STRIPE_LINKS.quarterly);
ok('prices are $2,997 / $7,991',
  api.SI_PRICES.monthly === 2997 && api.SI_PRICES.quarterly === 7991, api.SI_PRICES);
ok('regular termination clause is the verbatim quarterly wording',
  api.SI_REGULAR_TERMINATION.indexOf('full three (3) consecutive four-week terms') > -1
  && api.SI_REGULAR_TERMINATION.indexOf('may not be terminated during any active Quarterly Term') > -1,
  api.SI_REGULAR_TERMINATION.slice(0, 80));

// 2) Billing type → link choice / amount auto-fill.
ok('monthly billing auto-selects the monthly link', api._siLinkChoiceForBilling('monthly') === 'monthly');
ok('quarterly billing auto-selects the quarterly link', api._siLinkChoiceForBilling('quarterly') === 'quarterly');
ok('one-time billing forces the custom (pasted) link', api._siLinkChoiceForBilling('one_time') === 'custom');
ok('unknown billing defaults to custom', api._siLinkChoiceForBilling('') === 'custom');
ok('monthly auto-fills 2997', api._siAmountForBilling('monthly') === '2997');
ok('quarterly auto-fills 7991', api._siAmountForBilling('quarterly') === '7991');
ok('one-time leaves the amount free', api._siAmountForBilling('one_time') === '');

// 3) Payment-link resolution.
ok('fixed choice resolves to the fixed URL',
  api._siResolvePaymentLink({ payment_link_choice: 'monthly' }) === api.SI_STRIPE_LINKS.monthly);
ok('custom choice resolves to the pasted URL (trimmed)',
  api._siResolvePaymentLink({ payment_link_choice: 'custom', payment_link_custom: '  https://buy.stripe.com/abc  ' }) === 'https://buy.stripe.com/abc');

// 4) Validation.
ok('fully valid form passes', api._siValidate(valid()).length === 0, api._siValidate(valid()));
['client_name', 'closed_by', 'instagram', 'client_email', 'contract_start_date', 'deliverables', 'billing_type', 'termination_clause_type'].forEach(k => {
  const d = valid(); d[k] = '';
  ok('missing ' + k + ' is flagged', api._siValidate(d).indexOf(k) > -1, api._siValidate(d));
});
ok('bad email is flagged', api._siValidate(valid({ client_email: 'not-an-email' })).indexOf('client_email') > -1);
ok('zero amount is flagged', api._siValidate(valid({ invoice_amount: '0' })).indexOf('invoice_amount') > -1);
ok('blank amount is flagged', api._siValidate(valid({ invoice_amount: '' })).indexOf('invoice_amount') > -1);
ok('missing link choice is flagged', api._siValidate(valid({ payment_link_choice: '' })).indexOf('payment_link_choice') > -1);
ok('custom link without a URL is flagged',
  api._siValidate(valid({ payment_link_choice: 'custom', payment_link_custom: '' })).indexOf('payment_link_custom') > -1);
ok('custom link that is not http(s) is flagged',
  api._siValidate(valid({ payment_link_choice: 'custom', payment_link_custom: 'stripe.com/abc' })).indexOf('payment_link_custom') > -1);
ok('custom clause without text is flagged',
  api._siValidate(valid({ termination_clause_type: 'custom', termination_clause_custom: '' })).indexOf('termination_clause_custom') > -1);
ok('regular clause needs no textarea',
  api._siValidate(valid({ termination_clause_type: 'regular', termination_clause_custom: '' })).length === 0);
ok('one-time deal with pasted link + custom clause passes',
  api._siValidate(valid({ billing_type: 'one_time', invoice_amount: '5000', payment_link_choice: 'custom', payment_link_custom: 'https://buy.stripe.com/xyz', termination_clause_type: 'custom', termination_clause_custom: 'One-time: no renewal.' })).length === 0);

// 5) Submission payload shaping.
{
  const s = api._siBuildSubmission(valid({ client_email: ' Jane@Example.COM ' }));
  ok('email is trimmed + lowercased', s.client_email === 'jane@example.com', s.client_email);
  ok('amount is numeric', s.invoice_amount === 7991, s.invoice_amount);
  ok('fixed link travels as the real URL', s.payment_link === api.SI_STRIPE_LINKS.quarterly, s.payment_link);
  ok('regular clause travels verbatim in the payload', s.termination_clause_text === api.SI_REGULAR_TERMINATION);
  ok('source marks the sales-intake tab', s.source === 'syncview-sales-intake', s.source);
}
{
  const s = api._siBuildSubmission(valid({
    billing_type: 'one_time', invoice_amount: '5000',
    payment_link_choice: 'custom', payment_link_custom: 'https://buy.stripe.com/xyz',
    termination_clause_type: 'custom', termination_clause_custom: '  My custom clause.  '
  }));
  ok('custom link travels as pasted', s.payment_link === 'https://buy.stripe.com/xyz', s.payment_link);
  ok('custom clause travels trimmed', s.termination_clause_text === 'My custom clause.', s.termination_clause_text);
}

console.log(fail ? `\n${fail} failed, ${pass} passed ❌` : `\nAll ${pass} checks passed ✅`);
process.exit(fail ? 1 : 0);
