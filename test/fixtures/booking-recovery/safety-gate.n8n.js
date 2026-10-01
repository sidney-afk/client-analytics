// Copied from the live workflow. One edit: a real prospect name in the comments below was replaced by "a prospect" (public repo); no code changed.
// THE GATE. Sending "I saw you didn't book a time" to someone who DID book is
// the one failure that costs a call rather than merely missing one.
//
// FAIL-CLOSED, and note HOW. An earlier version tried to detect a failed CRM
// lookup by inspecting the items for an error field. That did not work, and
// execution 383587 proved it: a HubSpot error and a genuine "no such contact"
// both arrive as an empty item, indistinguishable, so the gate sent anyway.
// The fix is upstream — the HubSpot node is now onError:stopWorkflow, so if the
// lookup fails the execution dies here, nothing sends, and the error workflow
// DMs Sidney. By the time this code runs the lookup HAS succeeded, so an empty
// result genuinely means "not in the CRM" and is safe to chase.
//
// PAIRING: the HubSpot node REPLACES the item json with what it found, so this
// cannot read its own upstream fields from $input. It rebuilds the match by
// email AND phone against Select Due, because a search node emits a different
// number of items than it received whenever a lookup misses, and an index-based
// join would attribute one lead's booking status to another.
//
// 2026-09-04 — this gate now protects BOTH channels with the same tests.
// Previously 'park' (the phone-only SMS branch) was a key in REASONS, so it hit
// `continue` before a single booking test ran — recovery SMS had NO booking
// verification whatsoever, and a phone-only lead who booked got texted anyway.
// Now that every non-finisher gets both an email and a text, there is no park
// branch at all: one item per lead arrives here carrying _send_email/_send_sms,
// and it has to clear this gate before either message goes out.
//
// Also added iclosed_status === 'booked' as a booking signal. deal_id and
// lifecyclestage were the only two tests, and a prospect (2026-09-04) booked
// a call while staying lifecyclestage=lead with no deal — so the gate saw a
// contact who looked like he had never booked. Capture already writes 'booked'
// to the iclosed_status property on every booking, which makes it the one
// signal actually keyed to the thing we care about rather than to whether a
// deal happened to be minted.
//
// Select Due is still the FIRST line of defence — it drops anyone matching a
// row already marked booked, using our own table rather than the CRM. This gate
// is the backstop for the window between that read and the send.
const hits = $input.all();

const byKey = {};
for (const h of hits) {
  const j = h.json || {};
  const p = j.properties || j;
  const em = String(p.email || '').trim().toLowerCase();
  // Compare phones by DIGITS ONLY. HubSpot stores whatever was typed while we
  // store E.164, so '+1 (555) 000-1111' and '+15550001111' are the same human
  // and an exact string compare would silently match neither — which matters
  // because the form asks phone first, so most leads are phone-only.
  const ph = String(p.phone || '').replace(/[^0-9]/g, '').slice(-9);
  if (em) byKey['e:' + em] = p;
  if (ph.length >= 7) byKey['p:' + ph] = p;
}

// Terminal reasons that need no CRM lookup.
const REASONS = {
  expire: 'expired',
  stale: 'stale_prelaunch',
  optout: 'do_not_contact',
  booked_elsewhere: 'already_booked',
  done: 'contacted'
};

const out = [];
for (const item of $('Select Due').all()) {
  const r = item.json;

  if (REASONS[r._action]) {
    out.push({ json: Object.assign({}, r, { _route: 'suppress', suppressed_reason: REASONS[r._action] }) });
    continue;
  }

  const phDigits = String(r.phone || '').replace(/[^0-9]/g, '').slice(-9);
  const hs = byKey['e:' + String(r.email || '').trim().toLowerCase()]
          || (phDigits.length >= 7 ? byKey['p:' + phDigits] : null);

  // No HubSpot contact = never booked = safe to chase. That is the normal path
  // for an abandoned lead, because the booking router is what mints the contact.
  let booked = '';
  if (hs) {
    if (String(hs.deal_id || '').trim()) {
      booked = 'already_booked';
    } else if (String(hs.iclosed_status || '').trim().toLowerCase() === 'booked') {
      booked = 'already_booked';
    } else {
      const lc = String(hs.lifecyclestage || '').trim().toLowerCase();
      if (lc === 'customer' || lc === 'opportunity') booked = 'existing_' + lc;
    }
  }

  if (booked) {
    out.push({ json: Object.assign({}, r, { _route: 'suppress', suppressed_reason: booked }) });
    continue;
  }

  out.push({ json: Object.assign({}, r, { _route: 'send' }) });
}

return out;
