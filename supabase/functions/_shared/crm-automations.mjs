// The automations that touch a lead today, outside SyncView, as a plain list
// for the Leads page's Systems tab. ONE PLACE TO UPDATE: when an n8n workflow
// is added, changed or switched off, change its row here (and nothing else).
// The crm-leads function serves this list beside the sequences it reads from
// the database, so the Systems tab is generated from both.
//
// Public repo: describe senders by role only ("toll-free Twilio number",
// "hello@ Gmail"), never a phone number, address, id, token or name.
//
// Fields:
//   id        stable key
//   name      what the team calls it
//   trigger   what starts it
//   audience  who receives it
//   channel   email | sms | email+sms | telegram | meta_event
//   from      who it appears to come from
//   timing    when it goes out
//   logged    true once each send writes a crm_events row; false until the
//             n8n workflow calls crm-leads log_send (a later step)
//   owner     where it runs

export const N8N_AUTOMATIONS = [
  { id: 'booking_confirmation', name: 'Booking confirmation', trigger: 'A call is booked in iClosed', audience: 'The person who booked', channel: 'email+sms', from: 'hello@ Gmail signed Kasper; toll-free Twilio number', timing: 'Right after booking', logged: false, owner: 'n8n' },
  { id: 'pre_call_nurture', name: 'Pre-call nurture (6 emails)', trigger: 'A call is booked', audience: 'The person who booked', channel: 'email', from: 'hello@ Gmail signed Kasper', timing: 'Spread between booking and the call', logged: false, owner: 'n8n' },
  { id: 'recovery', name: 'Recovery (missed booking)', trigger: 'Someone starts booking and does not finish', audience: 'The person who started', channel: 'email+sms', from: 'hello@ Gmail signed Kasper; toll-free Twilio number', timing: 'Shortly after they drop off', logged: false, owner: 'n8n' },
  { id: 'reschedule', name: 'Reschedule notice', trigger: 'A booked call is moved', audience: 'The person who booked', channel: 'email', from: 'hello@ Gmail signed Kasper', timing: 'Right after the move', logged: false, owner: 'n8n' },
  { id: 'cancel', name: 'Cancellation notice', trigger: 'A booked call is cancelled', audience: 'The person who booked', channel: 'email', from: 'hello@ Gmail signed Kasper', timing: 'Right after the cancel', logged: false, owner: 'n8n' },
  { id: 'meta_booked_call', name: 'Meta "booked call" event', trigger: 'A call is booked', audience: 'Meta ads (conversion signal, no message)', channel: 'meta_event', from: 'Server event', timing: 'Right after booking', logged: false, owner: 'n8n' },
  { id: 'contract_email', name: 'Contract email', trigger: 'A deal is marked to contract', audience: 'The new client', channel: 'email', from: 'hello@ Gmail signed Kasper', timing: 'When the contract is sent', logged: false, owner: 'n8n' },
  { id: 'payment_email', name: 'Payment email', trigger: 'The contract is signed', audience: 'The new client', channel: 'email', from: 'hello@ Gmail signed Kasper', timing: 'After signing', logged: false, owner: 'n8n' },
  { id: 'onboarding_email', name: 'Onboarding email', trigger: 'The first payment arrives', audience: 'The new client', channel: 'email', from: 'hello@ Gmail signed Kasper', timing: 'After payment', logged: false, owner: 'n8n' },
  { id: 'inbound_text_relay', name: 'Inbound text relay', trigger: 'A lead texts the toll-free number', audience: 'Kasper', channel: 'telegram', from: 'Telegram to Kasper', timing: 'As each text arrives', logged: false, owner: 'n8n' },
];

export const AUTOMATION_CHANNELS = ['email', 'sms', 'email+sms', 'telegram', 'meta_event'];

/** One Systems row per sequence step, from the database rows. */
export function sequenceSystemRows(sequences, steps, activeCounts) {
  const out = [];
  for (const s of sequences || []) {
    const mine = (steps || []).filter((st) => st.sequence_id === s.id && st.is_current !== false).sort((a, b) => a.position - b.position);
    out.push({
      id: 'seq_' + s.key,
      name: s.name,
      trigger: s.description || 'Enrolled in Leads',
      audience: 'People in this sequence' + (activeCounts && activeCounts[s.id] ? ' (' + activeCounts[s.id] + ' now)' : ''),
      channel: Array.from(new Set(mine.map((st) => st.channel))).join('+') || 'none',
      from: 'Sent by the future n8n sender: email from hello@ Gmail signed Kasper, texts from the toll-free Twilio number',
      timing: mine.map((st) => 'day ' + st.day_offset).filter((v, i, a) => a.indexOf(v) === i).join(', '),
      logged: true,
      owner: 'SyncView sequence',
      active: !!s.active,
      approved: mine.filter((st) => st.approval_state === 'approved').length,
      steps: mine.length,
    });
  }
  return out;
}
