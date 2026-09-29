    /* ============================================================
       KASPER REVIEW TAB
       Hidden top-level nav unlocked by visiting ?Kasper=1.
       Sub-tabs live inside; the first is "Review Session" — a queue
       of every calendar card across all clients currently sitting on
       "Kasper Approval". Kasper watches the video, then either:
         • Approve  → status flips to "Client Approval"
         • Tweak    → leaves a comment and status flips to "Tweaks Needed"
       Comments piggyback on the existing tweaks JSON column the
       calendar uses, so they show up in the regular calendar Tweaks
       modal too. Status pushes to Linear via the existing webhook.
       ============================================================ */
    /* ============================================================
       SALES INTAKE MODULE (subtab of the Kasper tab, key 'sales-intake')
       Kasper closes a client on a call, fills this form, and submit kicks
       off the whole paperwork chain via n8n `sales-intake-submit`:
       Supabase `sales_intakes` audit row → eSignatures.com agreement from
       the Sales & Service Agreement template → ONE combined email to the
       client (signing link + Stripe payment link) → Slack DM confirmation.
       Spec: docs/features/SALES_INTAKE_DESIGN.md. Form mechanics mirror the onboarding
       form (draft autosave, keep-draft-on-failure, required-field
       validation); access rides the Kasper unlock because it renders only
       inside the Kasper page (see _kasperRenderSalesIntake / KASPER_SUBTABS).
       Namespaced _si/SI_. NOTE: the key is 'sales-intake' — never 'intake',
       which is the client Linear-submission mode (body.intake-mode).
       ============================================================ */
    const SALES_INTAKE_SUBMIT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/sales-intake-submit';
    const SI_DRAFT_KEY = 'syncview_sales_intake_draft_v1';
    // Fixed Stripe payment links (from Kasper, 2026-07-02 — docs/features/SALES_INTAKE_DESIGN.md).
    // Monthly = per-4-week subscription, Quarterly = per-12-week subscription.
    // Custom recurring / one-time deals get a pasted link instead.
    const SI_STRIPE_LINKS = {
        monthly: 'https://buy.stripe.com/00waEW0TI6Sb2Y1cl0ao80g',
        quarterly: 'https://buy.stripe.com/28E00i6e2ekD569dp4ao80q'
    };
    // Commas (fanbasis) counterparts of the same two packages, matched by price:
    // EWLKl = $2,997 "DFY 2026", jgQzB = $7,991 "DFY WOM / 12 WEEKS".
    // The agency slug is `hellofu5i` — verified live 2026-08-20; `synchro-social`
    // appears on older subscriber records but 404s.
    const SI_COMMAS_LINKS = {
        monthly: 'https://www.fanbasis.com/agency-checkout/hellofu5i/EWLKl',
        quarterly: 'https://www.fanbasis.com/agency-checkout/hellofu5i/jgQzB'
    };
    // Processor is a SECOND AXIS: processor x billing type picks the link.
    const SI_PAYMENT_LINKS = { stripe: SI_STRIPE_LINKS, commas: SI_COMMAS_LINKS };
    const SI_PROCESSOR_LABELS = { stripe: 'Stripe', commas: 'Commas' };
    // Which domains belong to which processor. Commas trades under TWO: commas.com
    // is the customer-facing checkout, www.fanbasis.com is the platform underneath.
    // A guard that knew only fanbasis.com passed a commas.com link on a deal marked
    // Stripe (2026-08-20, John Baker) — the money and the record disagreed.
    const SI_PROCESSOR_DOMAINS = {
        stripe: ['stripe.com'],
        commas: ['commas.com', 'fanbasis.com']
    };
    const SI_PRICES = { monthly: 2997, quarterly: 7991 };
    // Standard termination clause — verbatim from Kasper (2026-07-02). The wording
    // is quarterly-specific by design; for other deals Kasper picks Custom.
    const SI_REGULAR_TERMINATION = 'This Agreement may not be terminated during any active Quarterly Term. Upon acceptance, the Client is committed to completing the full three (3) consecutive four-week terms and shall remain responsible for all fees associated with that Quarterly Term, whether billed in advance or outstanding, regardless of whether the Client continues to use the services.';
    const SI_BILLING_LABELS = { monthly: 'Monthly - $2,997 / 4 weeks', quarterly: 'Quarterly - $7,991 / 12 weeks', custom_recurring: 'Custom recurring', one_time: 'One-time project fee' };
    const SI_CADENCE_LABELS = { four_week: 'Every 4 weeks', twelve_week: 'Every 12 weeks' };
    const SI_LINK_LABELS = { monthly: '4-week package link', quarterly: '12-week package link', custom: 'Custom link' };
    let _siAgreementPreview = null;

    // ---- pure helpers (unit-tested in test/sales-intake-form.js) ----
    function _siIsStandardBilling(billing) {
        return billing === 'monthly' || billing === 'quarterly';
    }
    function _siAllowsCustomAmount(billing) {
        return billing === 'custom_recurring' || billing === 'one_time';
    }
    function _siRequiresCadence(billing) {
        return billing === 'custom_recurring';
    }
    function _siResolveBillingCadence(d) {
        if (d.billing_type === 'monthly') return 'four_week';
        if (d.billing_type === 'quarterly') return 'twelve_week';
        if (d.billing_type === 'custom_recurring') return String(d.billing_cadence || '').trim();
        return '';
    }
    // Which payment-link radio a billing type locks to. Standard subscriptions
    // use fixed Stripe links; custom recurring and one-time require a pasted
    // Stripe link that matches the exact invoice amount.
    function _siLinkChoiceForBilling(billing) {
        if (billing === 'monthly' || billing === 'quarterly') return billing;
        if (billing === 'custom_recurring' || billing === 'one_time') return 'custom';
        return '';
    }
    // Auto-fill amount for the fixed-price subscriptions; '' = free entry.
    function _siAmountForBilling(billing) {
        return Object.prototype.hasOwnProperty.call(SI_PRICES, billing) ? String(SI_PRICES[billing]) : '';
    }
    function _siParseUsd(v) {
        const raw = String(v == null ? '' : v).replace(/[$,\s]/g, '');
        return raw ? Number(raw) : NaN;
    }
    function _siPlainUsd(n) {
        const amount = Number(n || 0);
        const hasCents = Math.round((amount % 1) * 100) !== 0;
        return amount.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 });
    }
    function _siFmtUsd(n) {
        const amount = Number(n || 0);
        const hasCents = Math.round((amount % 1) * 100) !== 0;
        return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: hasCents ? 2 : 0 });
    }
    function _siContractDateWords(value) {
        const d = new Date(String(value || '') + 'T12:00:00Z');
        return isNaN(d) ? String(value || '') : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
    }
    function _siDisplayFields(d) {
        const amount = _siParseUsd(d.invoice_amount);
        const amountVal = amount > 0 ? amount : 0;
        const cadence = _siResolveBillingCadence(d);
        const isTwelve = cadence === 'twelve_week';
        const isOneTime = d.billing_type === 'one_time';
        const firstName = String(d.client_name || '').trim().split(/\s+/)[0] || 'there';
        const billingLabel = d.billing_type === 'custom_recurring' && SI_CADENCE_LABELS[cadence]
            ? SI_BILLING_LABELS.custom_recurring + ' - ' + SI_CADENCE_LABELS[cadence]
            : (SI_BILLING_LABELS[d.billing_type] || d.billing_type || '');
        return {
            billing_cadence: cadence,
            billing_display_label: billingLabel,
            first_name: firstName,
            amount_plain: _siPlainUsd(amountVal),
            amount_fmt: _siFmtUsd(amountVal),
            billing_line: d.billing_type === 'monthly' ? 'billed every 4 weeks'
                : d.billing_type === 'quarterly' ? 'billed every 12 weeks'
                : d.billing_type === 'custom_recurring' ? (isTwelve ? 'custom recurring, billed every 12 weeks' : cadence === 'four_week' ? 'custom recurring, billed every 4 weeks' : 'custom recurring')
                : 'one-time project fee',
            contract_date_words: _siContractDateWords(d.contract_start_date),
            billing_period_words: isOneTime ? 'as a one-time project fee' : isTwelve ? 'per twelve (12) week period' : 'per four (4) week period',
            commitment_words: isOneTime
                ? 'This is a one-time engagement with a fixed scope; no recurring commitment applies.'
                : 'This Agreement operates on a minimum commitment of three (3) consecutive four-week terms ("Quarterly Term"), billed in advance.',
            billing_schedule_words: isOneTime
                ? 'The one-time project fee is due upon signing this Agreement.'
                : isTwelve
                ? 'Payment is due on the same weekday every twelve (12) weeks from the original start date and will be automatically charged using the card on file.'
                : 'Payment is due on the same weekday every four (4) weeks from the original start date and will be automatically charged using the card on file.'
        };
    }
    // The URL that will actually be emailed to the client.
    function _siResolvePaymentLink(d) {
        if (d.payment_link_choice === 'custom') return String(d.payment_link_custom || '').trim();
        const bank = SI_PAYMENT_LINKS[d.payment_processor];
        return (bank && bank[d.payment_link_choice]) || '';
    }
    function _siValidate(d) {
        const miss = [];
        ['client_name', 'closed_by', 'instagram', 'client_email', 'client_phone', 'contract_start_date', 'deliverables', 'billing_type', 'payment_processor', 'termination_clause_type'].forEach(k => { if (!String(d[k] || '').trim()) miss.push(k); });
        if (d.client_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.client_email).trim())) if (!miss.includes('client_email')) miss.push('client_email');
        const amt = _siParseUsd(d.invoice_amount);
        if (!(amt > 0)) miss.push('invoice_amount');
        const expectedLinkChoice = _siLinkChoiceForBilling(d.billing_type);
        if (_siRequiresCadence(d.billing_type) && !SI_CADENCE_LABELS[d.billing_cadence]) miss.push('billing_cadence');
        if (!d.payment_link_choice || (expectedLinkChoice && d.payment_link_choice !== expectedLinkChoice)) miss.push('payment_link_choice');
        else if (d.payment_link_choice === 'custom' && !/^https?:\/\/\S+$/i.test(String(d.payment_link_custom || '').trim())) miss.push('payment_link_custom');
        if (_siIsStandardBilling(d.billing_type) && amt !== SI_PRICES[d.billing_type] && !miss.includes('invoice_amount')) miss.push('invoice_amount');
        // A pasted link must belong to the processor that was picked. Selecting
        // Commas and pasting a buy.stripe.com URL would otherwise validate, and the
        // preview and payload would both claim Commas while the money went to Stripe.
        if (d.payment_link_choice === 'custom' && d.payment_processor) {
            const _u = String(d.payment_link_custom || '').toLowerCase();
            const _owner = Object.keys(SI_PROCESSOR_DOMAINS).find(p =>
                SI_PROCESSOR_DOMAINS[p].some(dom => _u.indexOf(dom) > -1));
            // Only reject when the link demonstrably belongs to the OTHER processor.
            // An unrecognised domain is left alone: Kasper legitimately pastes links
            // we have never seen, and blocking those would stop real closes.
            if (_owner && _owner !== d.payment_processor) {
                if (!miss.includes('payment_link_custom')) miss.push('payment_link_custom');
            }
        }
        // A phone that cannot be matched is worse than none: it reads as a working
        // fallback while silently never matching. HubSpot normalises to digits and the
        // receiver searches on the last 10, so anything shorter is unusable.
        if (String(d.client_phone || '').replace(/[^0-9]/g, '').length < 10 && !miss.includes('client_phone')) miss.push('client_phone');
        if (d.termination_clause_type === 'custom' && !String(d.termination_clause_custom || '').trim()) miss.push('termination_clause_custom');
        // Guard the RESOLVED url, not just the inputs that feed it. Without this a
        // missing processor or a gap in the link map yields '' and still passes,
        // and n8n rejects it with an opaque 500 after Kasper has hit send.
        if (!miss.length && !/^https?:\/\/\S+$/i.test(_siResolvePaymentLink(d))) miss.push('payment_link_choice');
        return miss;
    }
    // Shape the webhook payload. The regular clause text travels IN the
    // payload (not just the type) so n8n never needs its own copy of the
    // wording — the form is the single source of truth.
    function _siBuildSubmission(d) {
        const display = _siDisplayFields(d);
        return {
            closed_by: String(d.closed_by || '').trim(),
            client_name: String(d.client_name || '').trim(),
            client_email: String(d.client_email || '').trim().toLowerCase(),
            client_phone: String(d.client_phone || '').trim(),
            instagram: String(d.instagram || '').trim(),
            contract_start_date: String(d.contract_start_date || '').trim(),
            deliverables: String(d.deliverables || '').trim(),
            billing_type: d.billing_type,
            billing_cadence: display.billing_cadence,
            invoice_amount: _siParseUsd(d.invoice_amount),
            payment_link: _siResolvePaymentLink(d),
            payment_processor: d.payment_processor,
            termination_clause_type: d.termination_clause_type,
            termination_clause_text: d.termination_clause_type === 'custom' ? String(d.termination_clause_custom || '').trim() : SI_REGULAR_TERMINATION,
            referred_by: String(d.referred_by || '').trim(),
            source: 'syncview-sales-intake',
            created_at: new Date().toISOString(),
            billing_display_label: display.billing_display_label,
            first_name: display.first_name,
            amount_plain: display.amount_plain,
            amount_fmt: display.amount_fmt,
            billing_line: display.billing_line,
            contract_date_words: display.contract_date_words,
            billing_period_words: display.billing_period_words,
            commitment_words: display.commitment_words,
            billing_schedule_words: display.billing_schedule_words
        };
    }
    function _siAgreementFingerprint(s) {
        const keys = ['client_name', 'client_email', 'instagram', 'contract_start_date', 'deliverables', 'billing_type', 'billing_cadence', 'invoice_amount', 'payment_link', 'termination_clause_type', 'termination_clause_text', 'referred_by'];
        return JSON.stringify(keys.map(k => [k, s[k] == null ? '' : String(s[k])]));
    }
    function _siCurrentAgreementPreview(s) {
        const p = _siAgreementPreview;
        return p && p.fingerprint === _siAgreementFingerprint(s) ? p : null;
    }
    function _siEmailSubject(s) { return (s.first_name || 'there') + ', your Synchro Social agreement + first invoice'; }
    function _siBuildEmailHtml(s, signUrl) {
        const signHref = String(signUrl || '').trim();
        const payHref = s.payment_link || '#payment-link';
        const signClass = signHref ? 'si-email-btn sign' : 'si-email-btn sign disabled';
        const signAttrs = signHref ? ' href="' + _obEsc(signHref) + '" target="_blank" rel="noopener"' : ' href="#" aria-disabled="true"';
        const payAttrs = /^https?:\/\//i.test(payHref) ? ' href="' + _obEsc(payHref) + '" target="_blank" rel="noopener"' : ' href="#" aria-disabled="true"';
        return '<div class="si-email-divider"><img class="si-email-logo" src="https://synchrosocial.com/images/logo.png" alt="Synchro Social"></div>' +
            '<p>Hi ' + _obEsc(s.first_name || 'there') + ',</p>' +
            '<p>It was great talking with you — welcome aboard. Here&#39;s everything to make it official. Two quick steps and we get to work:</p>' +
            '<p><strong>Step 1 — Review and sign your agreement.</strong> It takes about two minutes:</p>' +
            '<p><a class="' + signClass + '"' + signAttrs + '>Review &amp; sign the agreement</a></p>' +
            '<p><strong>Step 2 — Take care of your first invoice</strong> — ' + _obEsc(s.amount_fmt) + ' (' + _obEsc(s.billing_line) + '):</p>' +
            '<p><a class="si-email-btn pay"' + payAttrs + '>Pay the invoice</a></p>' +
            '<p>Once both are done, your onboarding email lands in your inbox and the team gets moving on your content. If anything looks off, just reply to this email.</p>' +
            '<p>Warmly,</p>' +
            '<div class="si-email-signature"><img src="https://synchrosocial.com/images/logo.png" alt="Synchro Social"><div class="si-email-sig-text"><strong>Kasper</strong><br><a href="https://www.synchrosocial.com">synchrosocial.com</a></div></div>';
    }

    // ---- view ----
    function _siField(f) {
        const req = f.required === false ? '' : '<span class="si-req">*</span>';
        const help = f.help ? '<div class="si-help">' + f.help + '</div>' : '';
        let inner;
        if (f.type === 'textarea') {
            inner = '<textarea class="si-input" data-si="' + f.id + '" rows="' + (f.rows || 4) + '" placeholder="' + _obEsc(f.placeholder || '') + '"></textarea>';
        } else if (f.type === 'radio') {
            inner = '<div class="si-radios" data-si-radio="' + f.id + '">' +
                f.options.map(o => '<label class="si-pill"><input type="radio" name="si_' + f.id + '" value="' + _obEsc(o[0]) + '"><span>' + _obEsc(o[1]) + '</span></label>').join('') + '</div>';
        } else {
            inner = '<input class="si-input" type="' + (f.type || 'text') + '" data-si="' + f.id + '" placeholder="' + _obEsc(f.placeholder || '') + '"' + (f.inputmode ? ' inputmode="' + _obEsc(f.inputmode) + '"' : '') + (f.step ? ' step="' + f.step + '"' : '') + (f.min ? ' min="' + f.min + '"' : '') + '>';
        }
        return '<div class="si-q' + (f.full ? ' si-full' : '') + '" data-si-q="' + f.id + '"><label class="si-label">' + _obEsc(f.label) + req + '</label>' + help + inner + (f.after || '') + '</div>';
    }

    function renderSalesIntakeView() {
        const fields =
            _siField({ id: 'client_name', label: 'Client name', placeholder: 'Jane Doe' }) +
            _siField({ id: 'closed_by', label: 'Who closed the deal?', type: 'radio', options: [['Kasper', 'Kasper']] }) +
            _siField({ id: 'instagram', label: 'Client Instagram', placeholder: '@handle' }) +
            _siField({ id: 'client_email', label: 'Client email', type: 'email', placeholder: 'client@email.com', help: 'The agreement + invoice email goes here.' }) +
            _siField({ id: 'client_phone', label: 'Client phone', type: 'tel', inputmode: 'tel', placeholder: '+1 727 430 6456',
                help: 'How we still find them if they pay from a different email address than this one. That mismatch has stranded a paying client before.' }) +
            _siField({ id: 'contract_start_date', label: 'Contract start date', type: 'date' }) +
            _siField({ id: 'referred_by', label: 'Referred by', required: false, placeholder: 'Optional' }) +
            _siField({ id: 'deliverables', label: 'Deliverables for client', type: 'textarea', full: true, placeholder: 'What the client gets - free text, goes straight into the agreement.' }) +
            _siField({ id: 'billing_type', label: 'Billing type', type: 'radio', full: true, options: [['monthly', SI_BILLING_LABELS.monthly], ['quarterly', SI_BILLING_LABELS.quarterly], ['custom_recurring', SI_BILLING_LABELS.custom_recurring], ['one_time', SI_BILLING_LABELS.one_time]] }) +
            _siField({ id: 'billing_cadence', label: 'Recurring cadence', type: 'radio', full: true, options: [['four_week', SI_CADENCE_LABELS.four_week], ['twelve_week', SI_CADENCE_LABELS.twelve_week]], help: 'Required only for custom recurring packages.' }) +
            _siField({ id: 'invoice_amount', label: 'Invoice amount (USD)', type: 'text', inputmode: 'decimal', placeholder: '0.00', help: 'Custom recurring and one-time deals use a custom amount.', after: '<div class="si-locked-value" id="siAmountSummary" style="display:none"></div>' }) +
            _siField({
                id: 'payment_processor', label: 'Payment processor', type: 'radio', full: true,
                options: [['stripe', SI_PROCESSOR_LABELS.stripe], ['commas', SI_PROCESSOR_LABELS.commas]],
                help: 'Decides which account the money lands in. Deliberately has no default.'
            }) +
            _siField({
                id: 'payment_link_choice', label: 'Payment link', type: 'radio',
                options: [['monthly', SI_LINK_LABELS.monthly], ['quarterly', SI_LINK_LABELS.quarterly], ['custom', SI_LINK_LABELS.custom]],
                help: 'Custom recurring and one-time deals require the payment link created for that exact amount, on the processor picked above.',
                after: '<input class="si-input" type="url" data-si="payment_link_custom" placeholder="https://buy.stripe.com/... or https://www.fanbasis.com/agency-checkout/..." style="display:none;margin-top:6px">' +
                    '<div class="si-linkprev" id="siLinkPrev"></div>'
            }) +
            _siField({
                id: 'termination_clause_type', label: 'Termination clause', type: 'radio', full: true,
                options: [['regular', 'Regular'], ['custom', 'Custom']],
                help: 'Regular is the standard minimum-commitment wording. One-time deals usually need Custom.',
                after: '<div class="si-clause" id="siClausePrev" style="display:none">' + _obEsc(SI_REGULAR_TERMINATION) + '</div>' +
                    '<textarea class="si-input" data-si="termination_clause_custom" rows="4" placeholder="Paste the custom termination clause..." style="display:none;margin-top:6px"></textarea>'
            });
        return '<div class="si-wrap">' +
            '<div class="si-head"><div class="si-title">Fill this right after closing a client</div>' +
            '<div class="si-sub">It creates the Sales &amp; Service Agreement and emails the client the signing link with their invoice — one email, both links.</div></div>' +
            '<div class="si-card" id="siCard"><form id="siForm" onsubmit="return false;" novalidate>' +
            '<div class="si-grid">' + fields + '</div>' +
            '<div class="si-preview" id="siEmailPreview"></div>' +
            '<div class="si-err" id="siErr"></div>' +
            '<div class="si-actions"><button type="button" class="si-btn" id="siSubmit" onclick="_siSubmit()">Create agreement &amp; send</button>' +
            '<button type="button" class="si-btn-ghost" onclick="_siClearForm()">Clear form</button></div>' +
            '</form></div></div>';
    }

    /* ============================================================
       HIRING PROCESS (Kasper > More > Pipeline & Admin)

       The public application remains in iClosed. This private admin-only
       surface is the operational queue: it receives a server-side mirror,
       reveals details only after a row is selected, and queues (rather than
       directly sends) an interview invitation. It intentionally never calls
       iClosed, Gmail, n8n, or PostgREST from the browser.
       ============================================================ */
    const HIRING_APPLICATIONS_EF_URL = CAL_SUPABASE_URL + '/functions/v1/hiring-applications';
    const HP_FILTERS = [
        { key: 'new', label: 'New' },
        { key: 'reviewing', label: 'In review' },
        { key: 'hold', label: 'On hold' },
        { key: 'invited', label: 'Invited' },
        { key: 'all', label: 'All' },
    ];
    const HP_ROLES = [
        { key: 'client-success-content-manager', label: 'Client Success & Content Manager' },
        { key: 'video-editor', label: 'Video Editor' },
    ];
    const HP_APPLICATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const _hpState = {
        role: 'client-success-content-manager',
        filter: 'new',
        loadingList: false,
        loadingDetail: false,
        sending: false,
        list: [],
        selectedId: '',
        detail: null,
        listError: '',
        detailError: '',
        actionMessage: '',
        actionError: '',
        listRequest: 0,
        detailRequest: 0,
        actionRequest: 0,
        listController: null,
        detailController: null,
        actionController: null,
    };

    function _hpEsc(value) { return _calEsc(String(value == null ? '' : value)); }
    // A stored job body from before the HTML email rollout is plain text that
    // embedded the applicant's name unescaped -- rendering it via innerHTML
    // would be a stored-XSS hole. Only bodies our own server actually built as
    // HTML (which always start with this exact literal, never applicant-
    // influenced) are trusted to render as markup; anything else is shown as
    // escaped text, matching how it always rendered before this rollout.
    const HP_TRUSTED_EMAIL_HTML_PREFIX = '<div style="line-height: 1.4; font-family: Arial, sans-serif;">';
    function _hpEmailBodyHtml(value) {
        const body = String(value == null ? '' : value);
        return body.startsWith(HP_TRUSTED_EMAIL_HTML_PREFIX) ? body : _hpEsc(body);
    }
    function _hpApplicationId(value) {
        const id = String(value || '').trim();
        return HP_APPLICATION_ID.test(id) ? id : '';
    }
    function _hpStatus(value) {
        const status = String(value || 'new').trim().toLowerCase();
        return ['new', 'reviewing', 'hold', 'rejected', 'invited', 'interview_booked', 'withdrawn'].includes(status) ? status : 'new';
    }
    function _hpStatusLabel(value) {
        const status = _hpStatus(value);
        return status === 'interview_booked' ? 'Interview booked' : status.replace(/_/g, ' ');
    }
    function _hpSafeUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
        } catch (e) { return ''; }
    }
    function _hpShortDate(value) {
        const time = Date.parse(String(value || ''));
        if (!Number.isFinite(time)) return 'Recently';
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(time));
    }
    function _hpDisplayError(code, fallback) {
        const value = String(code || '').trim();
        if (value === 'unauthorized' || value === 'forbidden') return 'Your staff access does not allow this action.';
        if (value === 'feature_disabled') return 'Interview invitations are not enabled yet.';
        if (value === 'interview_event_not_configured') return 'The interview calendar has not been configured yet.';
        if (value === 'state_conflict') return 'This application changed elsewhere. Refreshing the latest details.';
        if (value === 'retry_not_available') return 'This cannot be retried automatically.';
        if (value === 'wrong_role') return 'This action does not apply to this applicant’s role.';
        if (value === 'practical_test_required') return 'A passed practical test is required before the interview invite can be sent.';
        if (value === 'practical_test_not_delivered') return 'The practical test email has not been delivered yet, so a verdict cannot be recorded.';
        if (value === 'invalid_verdict' || value === 'invalid_invite') return 'Check the fields and try again.';
        if (value === 'service_unavailable') return 'The hiring service is temporarily unavailable. Please try again.';
        return fallback || 'Something went wrong. Please try again.';
    }
    function _hpAbort(controllerName) {
        const controller = _hpState[controllerName];
        if (controller && typeof controller.abort === 'function') {
            try { controller.abort(); } catch (e) {}
        }
        _hpState[controllerName] = null;
    }
    function _hpPurgeSensitiveState() {
        _hpState.listRequest++;
        _hpState.detailRequest++;
        _hpState.actionRequest++;
        _hpAbort('listController');
        _hpAbort('detailController');
        _hpAbort('actionController');
        _hpState.role = 'client-success-content-manager';
        _hpState.filter = 'new';
        _hpState.loadingList = false;
        _hpState.loadingDetail = false;
        _hpState.sending = false;
        _hpState.list = [];
        _hpState.selectedId = '';
        _hpState.detail = null;
        _hpState.listError = '';
        _hpState.detailError = '';
        _hpState.actionMessage = '';
        _hpState.actionError = '';
        const mounted = document.getElementById('kasperContent');
        if (mounted && document.getElementById('hpBody')) {
            mounted.textContent = '';
        }
    }
    async function _hpCall(payload, controller) {
        await _syncviewRequireStaffIdentity('hiring');
        const send = () => fetch(HIRING_APPLICATIONS_EF_URL, {
            method: 'POST',
            headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, HIRING_APPLICATIONS_EF_URL),
            body: JSON.stringify(payload),
            signal: controller && controller.signal,
        });
        // Listing and opening an application are reads; every other action is a save.
        const isRead = !payload || payload.action === 'list' || payload.action === 'detail';
        const response = await (isRead ? send() : _writeUiTrackSave('hiring', ('hiring_' + payload.action).slice(0, 40), {}, send, { requireOk: true }));
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.ok !== true) {
            const error = new Error((data && data.error) || ('http_' + response.status));
            error.status = response.status;
            throw error;
        }
        return data;
    }
    function renderHiringProcessView() {
        const filters = HP_FILTERS.map(filter => `<button type="button" class="hp-filter${filter.key === _hpState.filter ? ' active' : ''}" aria-pressed="${filter.key === _hpState.filter ? 'true' : 'false'}" onclick="_hpSetFilter('${filter.key}')">${_hpEsc(filter.label)}</button>`).join('');
        const roles = HP_ROLES.map(role => `<button type="button" class="hp-filter${role.key === _hpState.role ? ' active' : ''}" aria-pressed="${role.key === _hpState.role ? 'true' : 'false'}" onclick="_hpSetRole('${role.key}')">${_hpEsc(role.label)}</button>`).join('');
        return `<div class="hp-wrap" id="hpBody">
            <div class="hp-head">
                <div>
                    <div class="hp-title">Hiring Process</div>
                    <div class="hp-sub">Review completed applications, then queue a thoughtful interview invitation only when you are ready.</div>
                </div>
                <button type="button" class="hp-refresh" onclick="_hpLoadList(true)" aria-label="Refresh applications">Refresh</button>
            </div>
            <div class="hp-roles" role="group" aria-label="Hiring role">${roles}</div>
            <div class="hp-filters" role="group" aria-label="Application status filters">${filters}</div>
            <div class="hp-workspace">
                <aside class="hp-list" aria-label="Applications">
                    <div class="hp-list-head"><span class="hp-list-title">Applications</span><span class="hp-list-count" id="hpListCount"></span></div>
                    <div id="hpListBody"><div class="hp-loading">Loading applications...</div></div>
                </aside>
                <section class="hp-detail" aria-live="polite">
                    <div class="hp-detail-head"><span class="hp-detail-title">Application detail</span><span class="hp-muted" id="hpDetailMeta"></span></div>
                    <div id="hpDetailBody"><div class="hp-detail-empty"><div><strong>Select an application</strong><br><span class="hp-muted">Its full answers and interview invitation preview will appear here.</span></div></div></div>
                </section>
            </div>
        </div>`;
    }
    function _hpRenderFilters() {
        const root = document.querySelector('.hp-filters');
        if (!root) return;
        root.innerHTML = HP_FILTERS.map(filter => `<button type="button" class="hp-filter${filter.key === _hpState.filter ? ' active' : ''}" aria-pressed="${filter.key === _hpState.filter ? 'true' : 'false'}" onclick="_hpSetFilter('${filter.key}')">${_hpEsc(filter.label)}</button>`).join('');
    }
    function _hpRenderRoles() {
        const root = document.querySelector('.hp-roles');
        if (!root) return;
        root.innerHTML = HP_ROLES.map(role => `<button type="button" class="hp-filter${role.key === _hpState.role ? ' active' : ''}" aria-pressed="${role.key === _hpState.role ? 'true' : 'false'}" onclick="_hpSetRole('${role.key}')">${_hpEsc(role.label)}</button>`).join('');
    }
    function _hpRenderList() {
        const body = document.getElementById('hpListBody');
        const count = document.getElementById('hpListCount');
        if (!body || !count) return;
        count.textContent = _hpState.loadingList ? 'Loading...' : String(_hpState.list.length);
        if (_hpState.loadingList && !_hpState.list.length) {
            body.innerHTML = '<div class="hp-loading">Loading applications...</div>';
            return;
        }
        if (_hpState.listError) {
            body.innerHTML = `<div class="hp-error">${_hpEsc(_hpState.listError)}<br><button type="button" class="hp-action" style="margin-top:12px" onclick="_hpLoadList(true)">Try again</button></div>`;
            return;
        }
        if (!_hpState.list.length) {
            body.innerHTML = '<div class="hp-empty">No applications in this view yet.</div>';
            return;
        }
        body.innerHTML = _hpState.list.map(item => {
            const id = _hpApplicationId(item && item.id);
            const active = id && id === _hpState.selectedId;
            const status = _hpStatus(item && item.status);
            const name = String(item && item.name || 'Unnamed applicant');
            const email = String(item && item.email || 'No email supplied');
            return `<button type="button" class="hp-row${active ? ' active' : ''}" aria-current="${active ? 'true' : 'false'}" data-hp-id="${_hpEsc(id)}" onclick="_hpSelect(this.dataset.hpId)">
                <span class="hp-row-top"><span class="hp-name">${_hpEsc(name)}</span><span class="hp-row-time">${_hpEsc(_hpShortDate(item && item.submitted_at))}</span></span>
                <span class="hp-email">${_hpEsc(email)}</span>
                <span class="hp-status ${_hpEsc(status)}">${_hpEsc(_hpStatusLabel(status))}</span>
            </button>`;
        }).join('');
    }
    function _hpAnswerEntries(value) {
        if (Array.isArray(value)) return value.map(entry => ({
            question: String(entry && (entry.question || entry.name || entry.label) || 'Question'),
            answer: String(entry && (entry.answer || entry.response || entry.value) || ''),
        }));
        if (value && typeof value === 'object') return Object.entries(value).map(([question, answer]) => ({
            question: String(question),
            answer: Array.isArray(answer) ? answer.join(', ') : (typeof answer === 'object' ? JSON.stringify(answer) : String(answer == null ? '' : answer)),
        }));
        return [];
    }
    function _hpRenderDetail() {
        const body = document.getElementById('hpDetailBody');
        const meta = document.getElementById('hpDetailMeta');
        if (!body || !meta) return;
        if (_hpState.loadingDetail && !_hpState.detail) {
            meta.textContent = 'Loading...';
            body.innerHTML = '<div class="hp-loading">Loading application details...</div>';
            return;
        }
        if (_hpState.detailError) {
            meta.textContent = '';
            body.innerHTML = `<div class="hp-error">${_hpEsc(_hpState.detailError)}<br><button type="button" class="hp-action" style="margin-top:12px" data-hp-id="${_hpEsc(_hpState.selectedId)}" onclick="_hpLoadDetail(this.dataset.hpId, true)">Try again</button></div>`;
            return;
        }
        const detail = _hpState.detail;
        if (!detail) {
            meta.textContent = '';
            body.innerHTML = '<div class="hp-detail-empty"><div><strong>Select an application</strong><br><span class="hp-muted">Its full answers and interview invitation preview will appear here.</span></div></div>';
            return;
        }
        const status = _hpStatus(detail.status);
        const submitted = _hpShortDate(detail.submitted_at);
        const answers = _hpAnswerEntries(detail.answers);
        const videoUrl = _hpSafeUrl(detail.video_url);
        const recordUrl = _hpSafeUrl(detail.iclosed_preview_url);
        const preview = detail.invite_preview || {};
        const inviteJobPreview = detail.invite_job_preview || null;
        // Once an invite job exists, in any state, its stored payload is what
        // a retry actually resends -- always prefer it over the freshly-built
        // preview, which can go stale the moment the job is queued.
        const inviteShown = inviteJobPreview || (preview.body ? preview : null);
        const inviteState = String(detail.invite_state || '').trim().toLowerCase();
        const invitationsEnabled = detail.invites_enabled === true;
        const isVideoEditor = String(detail.role_slug || '') === 'video-editor';
        const practicalVerdict = String(detail.practical_test_verdict || '').trim().toLowerCase();
        const practicalTestPassed = practicalVerdict === 'passed';
        const practicalTestGateBlocks = isVideoEditor && !practicalTestPassed;
        const deliveryPending = ['queued', 'dispatching', 'delivery_uncertain'].includes(inviteState);
        const canQueue = invitationsEnabled && !practicalTestGateBlocks && !['invited', 'interview_booked', 'rejected', 'withdrawn'].includes(status) && !inviteState;
        const canRetry = invitationsEnabled && detail.retry_available === true && inviteState === 'failed';
        const actionDisabled = _hpState.sending ? ' disabled aria-disabled="true"' : '';
        const existingNote = inviteState === 'sent'
            ? 'Interview invitation sent.'
            : (inviteState === 'queued' || inviteState === 'dispatching'
                ? 'Interview invitation is being sent.'
                : (inviteState === 'failed' ? 'The email was not sent before delivery began. You can retry it deliberately.'
                    : (inviteState === 'delivery_uncertain' ? 'Delivery needs confirmation before another invite can be sent.'
                        : (practicalTestGateBlocks ? 'This applicant needs a passed practical test before the final interview invite can be sent.'
                            : (!invitationsEnabled ? 'Interview invitations are not enabled yet.' : '')))));
        const practicalSection = isVideoEditor ? _hpRenderPracticalTestSection(detail, status, actionDisabled) : '';
        meta.textContent = submitted;
        body.innerHTML = `<div class="hp-detail-body">
            <div class="hp-person">
                <div><div class="hp-person-name">${_hpEsc(detail.name || 'Unnamed applicant')}</div><div class="hp-person-meta">${_hpEsc(detail.email || 'No email supplied')}${detail.location ? ' · ' + _hpEsc(detail.location) : ''}</div></div>
                <span class="hp-status ${_hpEsc(status)}">${_hpEsc(_hpStatusLabel(status))}</span>
            </div>
            <div class="hp-section">
                <div class="hp-section-title">Application</div>
                <div class="hp-person-meta">Submitted ${_hpEsc(submitted)}${detail.when_can_start ? ' · Can start: ' + _hpEsc(detail.when_can_start) : ''}${recordUrl ? ' · <a class="hp-link" href="' + _hpEsc(recordUrl) + '" target="_blank" rel="noopener noreferrer">Open in iClosed</a>' : ''}</div>
                ${videoUrl ? `<a class="hp-video" href="${_hpEsc(videoUrl)}" target="_blank" rel="noopener noreferrer">Open applicant video</a>` : ''}
                <div class="hp-actions">
                    ${!deliveryPending && !['rejected', 'withdrawn', 'interview_booked'].includes(status) && status !== 'reviewing' ? '<button type="button" class="hp-action" onclick="_hpSetStatus(\'reviewing\')"' + actionDisabled + '>Mark in review</button>' : ''}
                    ${!deliveryPending && !['rejected', 'withdrawn', 'interview_booked'].includes(status) && status !== 'hold' ? '<button type="button" class="hp-action" onclick="_hpSetStatus(\'hold\')"' + actionDisabled + '>Put on hold</button>' : ''}
                    ${!deliveryPending && !['invited', 'interview_booked', 'rejected', 'withdrawn'].includes(status) ? '<button type="button" class="hp-action danger" onclick="_hpSetStatus(\'rejected\')"' + actionDisabled + '>Mark not moving forward</button>' : ''}
                </div>
                <div class="hp-action-status${_hpState.actionError ? ' error' : ''}" id="hpApplicationActionStatus">${_hpEsc(_hpState.actionError || _hpState.actionMessage)}</div>
            </div>
            <div class="hp-section">
                <div class="hp-section-title">Answers</div>
                <div class="hp-answer-list">${answers.length ? answers.map(answer => `<div class="hp-answer"><div class="hp-answer-q">${_hpEsc(answer.question)}</div><div class="hp-answer-a">${_hpEsc(answer.answer)}</div></div>`).join('') : '<div class="hp-empty">No answers are available for this application.</div>'}</div>
            </div>
            ${practicalSection}
            <div class="hp-preview">
                <div class="hp-section-title">${isVideoEditor ? 'Final interview invitation preview' : 'Interview invitation preview'}</div>
                <div class="hp-preview-meta"><span><b>To:</b> ${_hpEsc(preview.recipient || detail.email || '')}</span><span><b>Subject:</b> ${_hpEsc((inviteShown && inviteShown.subject) || 'Interview invitation')}</span></div>
                <div class="hp-email">${inviteShown ? _hpEmailBodyHtml(inviteShown.body) : _hpEsc('The invitation preview will appear once the interview calendar is configured.')}</div>
                <div class="hp-actions">
                    ${canQueue ? '<button type="button" class="hp-action primary" id="hpInviteButton" onclick="_hpQueueInvite()"' + actionDisabled + '>Send interview invite</button>' : ''}
                    ${canRetry ? '<button type="button" class="hp-action primary" id="hpRetryInviteButton" onclick="_hpRetryInvite()"' + actionDisabled + '>Retry interview invite</button>' : ''}
                </div>
                <div class="hp-action-status${_hpState.actionError ? ' error' : ''}" id="hpActionStatus">${_hpEsc(_hpState.actionError || _hpState.actionMessage || existingNote)}</div>
            </div>
        </div>`;
    }
    function _hpRenderPracticalTestSection(detail, status, actionDisabled) {
        const testsEnabled = detail.practical_tests_enabled === true;
        const testState = String(detail.practical_test_state || '').trim().toLowerCase();
        const verdict = String(detail.practical_test_verdict || '').trim().toLowerCase();
        const jobPreview = detail.practical_test_job_preview || null;
        const preview = detail.practical_test_preview || null;
        const terminal = ['invited', 'interview_booked', 'rejected', 'withdrawn'].includes(status);
        const canQueueTest = testsEnabled && !!preview && !terminal && !testState;
        const canRetryTest = testsEnabled && detail.practical_test_retry_available === true && testState === 'failed';
        const canSetVerdict = testState === 'sent' && !verdict;
        let statusNote = '';
        if (!testsEnabled && !testState) statusNote = 'Practical test emails are not enabled yet.';
        else if (testsEnabled && !preview && !testState) statusNote = 'This applicant has no usable email address on file.';
        else if (testState === 'queued' || testState === 'dispatching') statusNote = 'Practical test email is being sent.';
        else if (testState === 'failed') statusNote = 'The email was not sent before delivery began. You can retry it deliberately.';
        else if (testState === 'delivery_uncertain') statusNote = 'Delivery needs confirmation before another practical test can be sent.';
        else if (verdict === 'passed') statusNote = 'Verdict: passed. The final interview invite is unlocked below.';
        else if (verdict === 'not_selected') statusNote = 'Verdict: not moving forward.';
        // A job's stored payload (once one exists, in any state) is what will
        // actually be sent/resent — it always wins over the freshly-built
        // preview, which can go stale the moment the job is queued.
        const shown = jobPreview || preview;
        return `<div class="hp-preview">
            <div class="hp-section-title">Practical test</div>
            ${shown ? `<div class="hp-preview-meta"><span><b>To:</b> ${_hpEsc((preview && preview.recipient) || detail.email || '')}</span><span><b>Subject:</b> ${_hpEsc(shown.subject)}</span></div><div class="hp-email">${_hpEmailBodyHtml(shown.body)}</div>` : ''}
            <div class="hp-actions">
                ${canQueueTest ? '<button type="button" class="hp-action primary" id="hpPracticalSendButton" onclick="_hpQueuePracticalTest()"' + actionDisabled + '>Send practical test</button>' : ''}
                ${canRetryTest ? '<button type="button" class="hp-action primary" onclick="_hpRetryPracticalTest()"' + actionDisabled + '>Retry practical test</button>' : ''}
                ${canSetVerdict ? '<button type="button" class="hp-action primary" onclick="_hpSetPracticalTestVerdict(\'passed\')"' + actionDisabled + '>Mark practical test passed</button>' : ''}
                ${canSetVerdict ? '<button type="button" class="hp-action danger" onclick="_hpSetPracticalTestVerdict(\'not_selected\')"' + actionDisabled + '>Mark not moving forward</button>' : ''}
            </div>
            ${statusNote ? `<div class="hp-action-status">${_hpEsc(statusNote)}</div>` : ''}
        </div>`;
    }
    function _hpPaint() { _hpRenderRoles(); _hpRenderFilters(); _hpRenderList(); _hpRenderDetail(); }
    async function _hpLoadList(force) {
        if (_hpState.loadingList && !force) return;
        _hpAbort('listController');
        const controller = new AbortController();
        _hpState.listController = controller;
        const request = ++_hpState.listRequest;
        _hpState.loadingList = true;
        _hpState.listError = '';
        _hpRenderList();
        try {
            const data = await _hpCall({ action: 'list', role: _hpState.role, status: _hpState.filter === 'all' ? null : _hpState.filter, limit: 100 }, controller);
            if (request !== _hpState.listRequest) return;
            _hpState.list = Array.isArray(data.applications) ? data.applications : [];
            if (_hpState.selectedId && !_hpState.list.some(item => String(item && item.id || '') === _hpState.selectedId)) {
                _hpState.selectedId = '';
                _hpState.detail = null;
            }
        } catch (e) {
            if (request !== _hpState.listRequest || (e && e.name === 'AbortError')) return;
            _hpState.listError = _hpDisplayError(e && e.message, 'Could not load applications.');
        } finally {
            if (request !== _hpState.listRequest) return;
            _hpState.loadingList = false;
            _hpState.listController = null;
            _hpRenderList();
            _hpRenderDetail();
        }
    }
    function _hpSetFilter(filter) {
        if (!HP_FILTERS.some(option => option.key === filter) || filter === _hpState.filter) return;
        _hpState.filter = filter;
        _hpState.selectedId = '';
        _hpState.detail = null;
        _hpState.detailError = '';
        _hpState.actionError = '';
        _hpState.actionMessage = '';
        _hpPaint();
        _hpLoadList(true);
    }
    function _hpSetRole(role) {
        if (!HP_ROLES.some(option => option.key === role) || role === _hpState.role) return;
        _hpState.role = role;
        _hpState.selectedId = '';
        _hpState.detail = null;
        _hpState.detailError = '';
        _hpState.actionError = '';
        _hpState.actionMessage = '';
        _hpPaint();
        _hpLoadList(true);
    }
    function _hpSelect(id) {
        const clean = _hpApplicationId(id);
        if (!clean || clean === _hpState.selectedId && _hpState.detail) return;
        _hpState.selectedId = clean;
        _hpState.detail = null;
        _hpState.detailError = '';
        _hpState.actionError = '';
        _hpState.actionMessage = '';
        _hpPaint();
        _hpLoadDetail(clean, true);
    }
    async function _hpLoadDetail(id, force) {
        const clean = _hpApplicationId(id || _hpState.selectedId);
        if (!clean || (_hpState.loadingDetail && !force)) return;
        _hpAbort('detailController');
        const controller = new AbortController();
        _hpState.detailController = controller;
        const request = ++_hpState.detailRequest;
        _hpState.loadingDetail = true;
        _hpState.detailError = '';
        _hpRenderDetail();
        try {
            const data = await _hpCall({ action: 'detail', application_id: clean }, controller);
            if (request !== _hpState.detailRequest || clean !== _hpState.selectedId) return;
            _hpState.detail = data.application || null;
        } catch (e) {
            if (request !== _hpState.detailRequest || (e && e.name === 'AbortError')) return;
            _hpState.detailError = _hpDisplayError(e && e.message, 'Could not load this application.');
        } finally {
            if (request !== _hpState.detailRequest) return;
            _hpState.loadingDetail = false;
            _hpState.detailController = null;
            _hpRenderDetail();
        }
    }
    async function _hpSetStatus(status) {
        const detail = _hpState.detail;
        if (!detail || _hpState.sending) return;
        if (status === 'rejected' && !window.confirm('Mark this applicant as not moving forward? This does not send an email.')) return;
        _hpAbort('actionController');
        const controller = new AbortController();
        _hpState.actionController = controller;
        const request = ++_hpState.actionRequest;
        _hpState.sending = true;
        _hpState.actionError = '';
        _hpState.actionMessage = 'Saving...';
        _hpRenderDetail();
        try {
            const data = await _hpCall({ action: 'set_status', application_id: detail.id, state_version: detail.state_version, status }, controller);
            if (request !== _hpState.actionRequest) return;
            _hpState.actionMessage = data.message || 'Status updated.';
            await _hpLoadDetail(detail.id, true);
            await _hpLoadList(true);
        } catch (e) {
            if (request !== _hpState.actionRequest || (e && e.name === 'AbortError')) return;
            _hpState.actionError = _hpDisplayError(e && e.message, 'Could not update this application.');
            if (e && e.message === 'state_conflict') _hpLoadDetail(detail.id, true);
        } finally {
            if (request !== _hpState.actionRequest) return;
            _hpState.sending = false;
            _hpState.actionController = null;
            _hpRenderDetail();
        }
    }
    async function _hpQueueInvite() {
        const detail = _hpState.detail;
        if (!detail || _hpState.sending) return;
        _hpAbort('actionController');
        const controller = new AbortController();
        _hpState.actionController = controller;
        const request = ++_hpState.actionRequest;
        _hpState.sending = true;
        _hpState.actionError = '';
        _hpState.actionMessage = 'Queueing interview invitation...';
        _hpRenderDetail();
        try {
            const data = await _hpCall({ action: 'queue_invite', application_id: detail.id, state_version: detail.state_version }, controller);
            if (request !== _hpState.actionRequest) return;
            _hpState.actionMessage = data.message || 'Interview invitation queued for delivery.';
            await _hpLoadDetail(detail.id, true);
            await _hpLoadList(true);
        } catch (e) {
            if (request !== _hpState.actionRequest || (e && e.name === 'AbortError')) return;
            _hpState.actionError = _hpDisplayError(e && e.message, 'Could not queue the interview invitation.');
            if (e && e.message === 'state_conflict') _hpLoadDetail(detail.id, true);
        } finally {
            if (request !== _hpState.actionRequest) return;
            _hpState.sending = false;
            _hpState.actionController = null;
            _hpRenderDetail();
        }
    }
    async function _hpRetryInvite() {
        const detail = _hpState.detail;
        if (!detail || _hpState.sending || detail.retry_available !== true) return;
        if (!window.confirm('Retry this interview invitation? It was confirmed not to have reached the email provider.')) return;
        _hpAbort('actionController');
        const controller = new AbortController();
        _hpState.actionController = controller;
        const request = ++_hpState.actionRequest;
        _hpState.sending = true;
        _hpState.actionError = '';
        _hpState.actionMessage = 'Requeueing interview invitation...';
        _hpRenderDetail();
        try {
            const data = await _hpCall({ action: 'retry_invite', application_id: detail.id, state_version: detail.state_version }, controller);
            if (request !== _hpState.actionRequest) return;
            _hpState.actionMessage = data.message || 'Interview invitation requeued for delivery.';
            await _hpLoadDetail(detail.id, true);
            await _hpLoadList(true);
        } catch (e) {
            if (request !== _hpState.actionRequest || (e && e.name === 'AbortError')) return;
            _hpState.actionError = _hpDisplayError(e && e.message, 'Could not retry the interview invitation.');
            if (e && (e.message === 'state_conflict' || e.message === 'retry_not_available')) _hpLoadDetail(detail.id, true);
        } finally {
            if (request !== _hpState.actionRequest) return;
            _hpState.sending = false;
            _hpState.actionController = null;
            _hpRenderDetail();
        }
    }
    async function _hpQueuePracticalTest() {
        const detail = _hpState.detail;
        if (!detail || _hpState.sending) return;
        _hpAbort('actionController');
        const controller = new AbortController();
        _hpState.actionController = controller;
        const request = ++_hpState.actionRequest;
        _hpState.sending = true;
        _hpState.actionError = '';
        _hpState.actionMessage = 'Queueing practical test...';
        _hpRenderDetail();
        try {
            const data = await _hpCall({
                action: 'queue_practical_test', application_id: detail.id, state_version: detail.state_version,
            }, controller);
            if (request !== _hpState.actionRequest) return;
            _hpState.actionMessage = data.message || 'Practical test queued for delivery.';
            await _hpLoadDetail(detail.id, true);
            await _hpLoadList(true);
        } catch (e) {
            if (request !== _hpState.actionRequest || (e && e.name === 'AbortError')) return;
            _hpState.actionError = (e && e.message === 'feature_disabled')
                ? 'Practical test emails are not enabled yet.'
                : _hpDisplayError(e && e.message, 'Could not queue the practical test.');
            if (e && e.message === 'state_conflict') _hpLoadDetail(detail.id, true);
        } finally {
            if (request !== _hpState.actionRequest) return;
            _hpState.sending = false;
            _hpState.actionController = null;
            _hpRenderDetail();
        }
    }
    async function _hpRetryPracticalTest() {
        const detail = _hpState.detail;
        if (!detail || _hpState.sending || detail.practical_test_retry_available !== true) return;
        if (!window.confirm('Retry this practical test email? It was confirmed not to have reached the email provider.')) return;
        _hpAbort('actionController');
        const controller = new AbortController();
        _hpState.actionController = controller;
        const request = ++_hpState.actionRequest;
        _hpState.sending = true;
        _hpState.actionError = '';
        _hpState.actionMessage = 'Requeueing practical test...';
        _hpRenderDetail();
        try {
            const data = await _hpCall({ action: 'retry_practical_test', application_id: detail.id, state_version: detail.state_version }, controller);
            if (request !== _hpState.actionRequest) return;
            _hpState.actionMessage = data.message || 'Practical test requeued for delivery.';
            await _hpLoadDetail(detail.id, true);
            await _hpLoadList(true);
        } catch (e) {
            if (request !== _hpState.actionRequest || (e && e.name === 'AbortError')) return;
            _hpState.actionError = (e && e.message === 'feature_disabled')
                ? 'Practical test emails are not enabled yet.'
                : _hpDisplayError(e && e.message, 'Could not retry the practical test.');
            if (e && (e.message === 'state_conflict' || e.message === 'retry_not_available')) _hpLoadDetail(detail.id, true);
        } finally {
            if (request !== _hpState.actionRequest) return;
            _hpState.sending = false;
            _hpState.actionController = null;
            _hpRenderDetail();
        }
    }
    async function _hpSetPracticalTestVerdict(verdict) {
        const detail = _hpState.detail;
        if (!detail || _hpState.sending || !['passed', 'not_selected'].includes(verdict)) return;
        if (verdict === 'not_selected' && !window.confirm('Mark this applicant as not moving forward? This does not send an email.')) return;
        _hpAbort('actionController');
        const controller = new AbortController();
        _hpState.actionController = controller;
        const request = ++_hpState.actionRequest;
        _hpState.sending = true;
        _hpState.actionError = '';
        _hpState.actionMessage = 'Saving...';
        _hpRenderDetail();
        try {
            const data = await _hpCall({ action: 'set_practical_test_verdict', application_id: detail.id, state_version: detail.state_version, verdict }, controller);
            if (request !== _hpState.actionRequest) return;
            _hpState.actionMessage = data.message || 'Practical test verdict recorded.';
            await _hpLoadDetail(detail.id, true);
            await _hpLoadList(true);
        } catch (e) {
            if (request !== _hpState.actionRequest || (e && e.name === 'AbortError')) return;
            _hpState.actionError = _hpDisplayError(e && e.message, 'Could not record the practical test verdict.');
            if (e && e.message === 'state_conflict') _hpLoadDetail(detail.id, true);
        } finally {
            if (request !== _hpState.actionRequest) return;
            _hpState.sending = false;
            _hpState.actionController = null;
            _hpRenderDetail();
        }
    }

    function _siSerialize() {
        const form = document.getElementById('siForm'); const out = {};
        if (!form) return out;
        form.querySelectorAll('[data-si]').forEach(el => { out[el.getAttribute('data-si')] = String(el.value || '').trim(); });
        form.querySelectorAll('[data-si-radio]').forEach(g => { const n = g.getAttribute('data-si-radio'); const s = g.querySelector('input:checked'); out[n] = s ? s.value : ''; });
        return out;
    }
    function _siSetRadio(name, val) {
        const g = document.querySelector('[data-si-radio="' + name + '"]'); if (!g) return;
        g.querySelectorAll('input').forEach(i => { i.checked = (i.value === val); });
    }
    function _siSyncBillingControls(resetAmount) {
        const d = _siSerialize();
        const amount = document.querySelector('[data-si="invoice_amount"]');
        const amountSummary = document.getElementById('siAmountSummary');
        const standardAmount = _siAmountForBilling(d.billing_type);
        if (amount) {
            const customAmount = _siAllowsCustomAmount(d.billing_type);
            amount.readOnly = !customAmount;
            amount.style.display = customAmount ? '' : 'none';
            if (_siIsStandardBilling(d.billing_type)) amount.value = standardAmount;
            else if (resetAmount) amount.value = '';
        }
        if (amountSummary) {
            const showSummary = _siIsStandardBilling(d.billing_type);
            amountSummary.style.display = showSummary ? '' : 'none';
            amountSummary.textContent = showSummary ? _siFmtUsd(standardAmount) + ' fixed package amount' : '';
        }
        const expectedLink = _siLinkChoiceForBilling(d.billing_type);
        if (expectedLink) _siSetRadio('payment_link_choice', expectedLink);
        const linkGroup = document.querySelector('[data-si-radio="payment_link_choice"]');
        if (linkGroup) {
            linkGroup.style.display = 'none';
            linkGroup.querySelectorAll('input').forEach(i => { i.disabled = !!expectedLink; });
        }
        const cadenceQ = document.querySelector('[data-si-q="billing_cadence"]');
        if (cadenceQ) cadenceQ.style.display = _siRequiresCadence(d.billing_type) ? '' : 'none';
        if (!_siRequiresCadence(d.billing_type)) _siSetRadio('billing_cadence', '');
    }
    function _siRenderEmailPreview() {
        const box = document.getElementById('siEmailPreview');
        if (!box) return;
        const s = _siBuildSubmission(_siSerialize());
        const preview = _siCurrentAgreementPreview(s);
        const btnText = preview ? 'Agreement preview ready' : 'Generate agreement preview';
        box.innerHTML = '<div class="si-preview-head"><div class="si-preview-head-main"><div class="si-preview-title">Email preview</div>' +
            '<div class="si-preview-subject">' + _obEsc(_siEmailSubject(s)) + '</div></div>' +
            '<button type="button" class="si-btn-ghost" id="siPreviewAgreementBtn" onclick="_siGenerateAgreementPreview()" ' + (preview ? 'disabled' : '') + '>' + btnText + '</button></div>' +
            '<div class="si-email-preview">' + _siBuildEmailHtml(s, preview && preview.sign_url) + '</div>';
    }
    // Reflect current picks into the dependent controls: custom-link input,
    // link preview, clause preview/textarea, and the email preview.
    function _siSyncVisibility() {
        _siSyncBillingControls(false);
        const d = _siSerialize();
        const customUrl = document.querySelector('[data-si="payment_link_custom"]');
        const customPayment = _siLinkChoiceForBilling(d.billing_type) === 'custom';
        if (customUrl) customUrl.style.display = customPayment ? '' : 'none';
        const prev = document.getElementById('siLinkPrev');
        if (prev) {
            const url = _siResolvePaymentLink(d);
            // Name the processor actually selected. A preview that always says
            // "Stripe" is the only manual check between a wrong link and a client.
            const procName = SI_PROCESSOR_LABELS[d.payment_processor] || 'Payment';
            if (_siIsStandardBilling(d.billing_type) && url) prev.innerHTML = '<div class="si-locked-value"><b>' + _obEsc(procName) + ' link:</b> <a href="' + _obEsc(url) + '" target="_blank" rel="noopener">' + _obEsc(url) + '</a></div>';
            else if (customPayment && url) prev.innerHTML = '<b>' + _obEsc(procName) + ' link:</b> <a href="' + _obEsc(url) + '" target="_blank" rel="noopener">Open pasted link</a>';
            else prev.innerHTML = customPayment ? 'Paste the payment link Kasper created for this deal.' : (d.payment_processor ? '' : 'Pick a payment processor above.');
        }
        const clausePrev = document.getElementById('siClausePrev');
        if (clausePrev) clausePrev.style.display = d.termination_clause_type === 'regular' ? '' : 'none';
        const clauseTa = document.querySelector('[data-si="termination_clause_custom"]');
        if (clauseTa) clauseTa.style.display = d.termination_clause_type === 'custom' ? '' : 'none';
        _siRefreshMissingState();
        _siRenderEmailPreview();
    }
    // Billing type drives the amount AND the link choice (spec fields 7–9):
    // overwrite both on every explicit change; custom paths clear the amount
    // for free entry and force the pasted-link path.
    function _siBillingChanged() {
        _siSyncBillingControls(true);
        _siSyncVisibility();
    }

    let _siDraftT = null;
    function _siSaveDraftDebounced() { clearTimeout(_siDraftT); _siDraftT = setTimeout(() => { try { localStorage.setItem(SI_DRAFT_KEY, JSON.stringify(_siSerialize())); } catch (e) {} }, 500); }
    function _siRestoreDraft() {
        let d = null; try { d = JSON.parse(localStorage.getItem(SI_DRAFT_KEY) || 'null'); } catch (e) {}
        if (!d) return;
        const form = document.getElementById('siForm'); if (!form) return;
        form.querySelectorAll('[data-si]').forEach(el => { const k = el.getAttribute('data-si'); if (d[k] != null) el.value = d[k]; });
        form.querySelectorAll('[data-si-radio]').forEach(g => { const v = d[g.getAttribute('data-si-radio')]; if (v) { const i = g.querySelector('input[value="' + v + '"]'); if (i) i.checked = true; } });
    }
    function _siClearForm() {
        _siAgreementPreview = null;
        try { localStorage.removeItem(SI_DRAFT_KEY); } catch (e) {}
        _kasperRenderSalesIntake();
    }

    function _siInvalidateAgreementPreview() {
        if (_siAgreementPreview) _siAgreementPreview = null;
    }

    function _siQuestionForMissingKey(k) {
        return document.querySelector('[data-si-q="' + k + '"]') ||
            document.querySelector('[data-si-q="' + k.replace(/_custom$/, '_choice') + '"]') ||
            document.querySelector('[data-si-q="' + k.replace(/_custom$/, '_type') + '"]');
    }
    function _siShowMissing(miss, message) {
        const err = document.getElementById('siErr');
        document.querySelectorAll('.si-q.si-missing').forEach(q => q.classList.remove('si-missing'));
        if (err) {
            err.style.display = 'block';
            err.textContent = message || ('Please fill the highlighted fields (' + miss.length + ' left).');
        }
        let first = null;
        miss.forEach(k => {
            const q = _siQuestionForMissingKey(k);
            if (q) { q.classList.add('si-missing'); if (!first) first = q; }
        });
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function _siRefreshMissingState() {
        const marked = Array.from(document.querySelectorAll('.si-q.si-missing'));
        if (!marked.length) return;
        const miss = _siValidate(_siSerialize());
        const stillMissing = new Set(miss.map(_siQuestionForMissingKey).filter(Boolean));
        marked.forEach(q => { if (!stillMissing.has(q)) q.classList.remove('si-missing'); });
        const err = document.getElementById('siErr');
        if (err && !miss.length) {
            err.style.display = 'none';
            err.textContent = '';
        }
    }

    function mountSalesIntakeView() {
        const form = document.getElementById('siForm'); if (!form) return;
        _siRestoreDraft();
        // Defaults AFTER the restore so a saved draft wins over them.
        const dt = form.querySelector('[data-si="contract_start_date"]');
        if (dt && !dt.value) dt.value = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD — "the day the deal closed"
        const d = _siSerialize();
        if (!d.closed_by) _siSetRadio('closed_by', 'Kasper'); // only closer today
        _siSyncVisibility();
        form.addEventListener('input', () => { _siInvalidateAgreementPreview(); _siSyncVisibility(); _siSaveDraftDebounced(); });
        form.addEventListener('change', e => {
            const t = e.target;
            _siInvalidateAgreementPreview();
            if (t && t.name === 'si_billing_type') _siBillingChanged();
            else if (t && (t.name === 'si_payment_processor' || t.name === 'si_payment_link_choice' || t.name === 'si_billing_cadence' || t.name === 'si_termination_clause_type')) _siSyncVisibility();
            _siSaveDraftDebounced();
        });
        // Live link preview while a custom URL is being typed.
        const cu = form.querySelector('[data-si="payment_link_custom"]');
        if (cu) cu.addEventListener('input', _siSyncVisibility);
    }

    function _siGenerateAgreementPreview() {
        const err = document.getElementById('siErr');
        const d = _siSerialize();
        const miss = _siValidate(d);
        if (miss.length) {
            _siShowMissing(miss, 'Fill the highlighted fields before generating the agreement preview.');
            return;
        }
        if (err) err.style.display = 'none';
        const btn = document.getElementById('siPreviewAgreementBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Generating agreement...'; }
        const submission = _siBuildSubmission(d);
        _obPost(SALES_INTAKE_SUBMIT_URL, { action: 'preview_contract', submission }, 45000)
            .then(resp => {
                if (!resp || !resp.sign_url || !resp.contract_id || !resp.id) throw new Error((resp && (resp.error || resp.message)) || 'agreement preview did not return a signing link');
                _siAgreementPreview = {
                    id: String(resp.id),
                    contract_id: String(resp.contract_id),
                    sign_url: String(resp.sign_url),
                    fingerprint: _siAgreementFingerprint(submission)
                };
                if (err) err.style.display = 'none';
                _siRenderEmailPreview();
            })
            .catch(e => {
                if (btn) { btn.disabled = false; btn.textContent = 'Generate agreement preview'; }
                if (err) {
                    err.style.display = 'block';
                    err.textContent = 'Could not generate the agreement preview (' + ((e && e.message) || 'network error') + '). Your form draft is still saved.';
                }
            });
    }

    function _siSubmit() {
        const err = document.getElementById('siErr');
        const d = _siSerialize();
        const miss = _siValidate(d);
        if (miss.length) {
            _siShowMissing(miss);
            return;
        }
        err.style.display = 'none';
        const btn = document.getElementById('siSubmit');
        btn.disabled = true; btn.textContent = 'Creating agreement…';
        const submission = _siBuildSubmission(d);
        // Draft is only cleared on success — a failed webhook keeps everything
        // typed so Kasper can just hit the button again (onboarding-form rule).
        const preview = _siCurrentAgreementPreview(submission);
        const payload = preview ? {
            action: 'send_existing_contract',
            submission: Object.assign({}, submission, {
                preview_id: preview.id,
                preview_contract_id: preview.contract_id,
                preview_sign_url: preview.sign_url
            })
        } : { submission };
        if (preview) btn.textContent = 'Sending agreement...';
        _obPost(SALES_INTAKE_SUBMIT_URL, payload, 45000)
            .then(resp => {
                _siAgreementPreview = null;
                try { localStorage.removeItem(SI_DRAFT_KEY); } catch (e) {}
                _siShowDone(submission, resp || {});
            })
            .catch(e => {
                _writeUiRecordSaveFailure('sales_intake', 'sales_intake_submit', e, null, {});
                btn.disabled = false; btn.textContent = 'Create agreement & send';
                err.style.display = 'block';
                err.textContent = 'Could not send the intake (' + ((e && e.message) || 'network error') + '). Nothing was lost — your answers are saved in this browser. Try again in a minute.';
            });
    }

    function _siShowDone(s, resp) {
        const card = document.getElementById('siCard'); if (!card) return;
        const row = (k, v) => '<div class="si-done-row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
        const signUrl = resp && resp.sign_url ? String(resp.sign_url) : '';
        const actionLinks = (signUrl ? '<a class="si-btn-link" href="' + _obEsc(signUrl) + '" target="_blank" rel="noopener">Open agreement</a>' : '') +
            (s.payment_link ? '<a class="si-btn-link" href="' + _obEsc(s.payment_link) + '" target="_blank" rel="noopener">Open invoice</a>' : '') +
            '<button type="button" class="si-btn" onclick="_siClearForm()">New intake</button>';
        card.className = 'si-done';
        card.innerHTML = '<div class="si-done-ico">✓</div><h2>Intake sent</h2>' +
            '<p>The agreement is being created and ' + _obEsc(s.client_email) + ' gets one email with the signing link and the invoice.</p>' +
            '<div class="si-done-summary">' +
            row('Client', _obEsc(s.client_name)) +
            row('Billing', _obEsc(s.billing_display_label || SI_BILLING_LABELS[s.billing_type] || s.billing_type)) +
            row('Invoice amount', _siFmtUsd(s.invoice_amount)) +
            row('Payment link', _obEsc(s.payment_link)) +
            row('Termination clause', s.termination_clause_type === 'regular' ? 'Regular' : 'Custom') +
            (resp && resp.contract_id ? row('Contract', _obEsc(String(resp.contract_id))) : '') +
            '</div>' +
            '<div class="si-actions" style="justify-content:center">' + actionLinks + '</div>';
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    /* The Samples subtab was folded into Review (samples are listed in the
       Review queue) and then removed. Links that still name it, including
       urgent pings already sent, open Review instead of failing. */
    const KASPER_PRIMARY_SUBTAB_KEYS = ['review', 'replies', 'filming'];
    const KASPER_PRIMARY_SHORT_LABELS = { review: 'Review', replies: 'Messages', filming: 'Filming' };
    const KASPER_MORE_GROUPS = [
        { label: 'Team', keys: ['editors', 'time-off'] },
        { label: 'Pipeline & Admin', keys: ['sales-intake', 'hiring-process', 'onboarding', 'quiz-leads', 'client-credentials', 'clients', 'save-problems'] },
        { label: 'Analytics', keys: ['ad-performance'] },
    ];
    const KASPER_MORE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="3" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="6.5"/></svg>';
    const KASPER_MORE_CHEVRON = '<svg class="kasper-more-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
    // Optional override — if your workspace's primary domain is known, set it here.
    // Without it the Slack button falls back to opening Slack and searching the SMM's name.
    const KASPER_SLACK_TEAM_DOMAIN = '';

    const KASPER_HISTORY_KEY = 'syncview_kasper_approved_log_v1';
    const KASPER_HISTORY_CAP = 200;
    const KASPER_SUBTAB_KEY = 'syncview_kasper_subtab_v1';
    const KASPER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // sanity bound; staleness is fine, ancient data is not
    // "Last week's editor labour" never changes once a week has passed, so
    // cache the workflow response in localStorage. The cache survives across
    // page reloads (until the user clicks Refresh or the calendar crosses
    // into a new "last week").
    const KASPER_EDITORS_CACHE_KEY = 'syncview_kasper_editors_v3';
    const KASPER_EDITORS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks — pure sanity bound
    const KASPER_FILMING_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min — content/coverage drift slowly
    // Content-bank thresholds. These are intentionally counts, not an assumed
    // posting cadence: every client can see exactly how much active calendar
    // content is available, whether or not it already has a calendar date.
    const FILMING_CONTENT_RED_COUNT = 10;
    const FILMING_CONTENT_COVERED_COUNT = 21;
    const FILMING_PLAN_SOON_DAYS = 14;
    /* RELOAD RACE (speed map 2026-09-23 §7). On a reload the stored staff
       identity is not yet re-verified, so every _syncviewStaffCan() check reads
       false until key-verify answers. The capability gates below used to treat
       that as "not allowed" and fall back to review -- rewriting both the URL
       and the saved subtab to review, so nothing was left to restore once the
       check passed. Hiring (admin only) lost every reload; onboarding lost
       whenever the tab painted before key-verify answered.

       While verification is pending the fallback is now TEMPORARY: review
       shows, but the hash and saved subtab keep the requested tab, and
       _kasperRestorePendingSubtab() puts it back when the check settles. A
       real denial (verified, wrong role; or signed out) falls back as before. */
    let _kasperPendingSubtab = '';
    let _kasperPendingEpoch = -1;   // _syncviewNavEpoch when it was parked (Phase D guard)
    function _kasperStaffCheckPending() {
        try {
            if (typeof _syncviewStaffIdentityValid === 'function' && _syncviewStaffIdentityValid()) return false;
            const id = typeof _syncviewStaffIdentityLoad === 'function' ? _syncviewStaffIdentityLoad() : null;
            return !!(id && id.key && id.member && id.member.id);
        } catch (e) { return false; }
    }
    function _kasperDenySubtab(capability) {
        if (!_kasperStaffCheckPending()) _syncviewOfferStaffSignIn(capability);
        _kasperFallbackToReview();
    }
    function _kasperRestorePendingSubtab() {
        const want = _kasperPendingSubtab;
        if (!want) return;
        if (_kasperStaffCheckPending()) return;          // still waiting on key-verify
        _kasperPendingSubtab = '';
        // Phase D's navigation epoch: any navTo since this was parked means the
        // visitor moved on, and their choice wins over the restore.
        if (_syncviewNavEpoch !== _kasperPendingEpoch || currentNav !== 'kasper' || _kasperState.tab !== 'review') return;
        // _kasperGotoTab runs every subtab's own capability check; if it
        // declines, the denial is settled, so persist review as before.
        _kasperGotoTab(want);
        if (_kasperState.tab !== want) { _kasperState.tab = want; _kasperFallbackToReview(); }
    }
    function _kasperFallbackToReviewNow() {
        const wanted = _kasperState.tab;
        _kasperState.tab = 'review';
        if (wanted && wanted !== 'review' && _kasperStaffCheckPending()) {
            _kasperPendingSubtab = wanted;
            _kasperPendingEpoch = _syncviewNavEpoch;
            if (typeof _kasperSyncTabNav === 'function') _kasperSyncTabNav();
            return;
        }
        try { localStorage.setItem(KASPER_SUBTAB_KEY, 'review'); } catch (e) {}
        try {
            if (typeof currentNav !== 'undefined' && currentNav === 'kasper') {
                history.replaceState({ nav: 'kasper' }, '', '/' + svRoute.search() + '#kasper');
            }
        } catch (e) {}
        if (typeof _kasperSyncTabNav === 'function') _kasperSyncTabNav();
    }
    try {
        const _kSavedSub = localStorage.getItem(KASPER_SUBTAB_KEY);
        const _kSavedKey = _kSavedSub ? _kasperResolveSubtab(_kSavedSub) : '';
        if (_kSavedKey) _kasperState.tab = _kSavedKey;
    } catch (e) {}

    function renderKasperView() {
        if (_kasperState.tab === 'time-off' && (!_ptoEnabled() || !_syncviewStaffCan('pto-admin'))) _kasperFallbackToReview();
        if (_kasperState.tab === 'hiring-process' && !_syncviewStaffCan('hiring')) _kasperFallbackToReview();
        const visibleTabs = KASPER_SUBTABS.filter(t => t.key !== 'time-off' || _ptoEnabled());
        const tabButtonHtml = (t, inMore) => {
            const capability = t.key === 'client-credentials' ? 'credentials' : (t.key === 'onboarding' ? 'onboarding' : (t.key === 'time-off' ? 'pto-admin' : ''));
            const gatedCapability = t.key === 'hiring-process' ? 'hiring'
                : (t.key === 'quiz-leads' ? 'quiz-leads' : ((t.key === 'clients' || t.key === 'save-problems') ? 'clients-admin' : capability));
            const gated = gatedCapability ? ` data-staff-capability="${gatedCapability}"${_syncviewStaffCan(gatedCapability) ? '' : ' hidden'}` : '';
            const active = _kasperState.tab === t.key;
            const count = t.showCount === false ? '' : `<span class="kasper-tab-count" data-kasper-count="${t.key}"${t.hideZero ? ' data-kasper-hide-zero' : ''}>·</span>`;
            const shortLabel = KASPER_PRIMARY_SHORT_LABELS[t.key] || t.label;
            return `
            <button type="button" class="kasper-subtab ${inMore ? 'kasper-more-item' : 'kasper-primary-tab'}${active ? ' active' : ''}" data-kasper-tab="${t.key}"${gated}${inMore ? ' role="menuitem" tabindex="-1"' : ''}${active ? ' aria-current="page"' : ''} title="${_calEsc(t.label)}" onclick="_kasperGotoTab('${t.key}')">
                ${t.icon}<span class="kasper-tab-label-full">${_calEsc(t.label)}</span><span class="kasper-tab-label-short">${_calEsc(shortLabel)}</span>${count}
            </button>`;
        };
        const primaryTabs = KASPER_PRIMARY_SUBTAB_KEYS
            .map(key => visibleTabs.find(t => t.key === key))
            .filter(Boolean);
        const primaryTabsHtml = primaryTabs.map(t => tabButtonHtml(t, false)).join('');
        const moreGroupsHtml = KASPER_MORE_GROUPS.map(group => {
            const groupTabs = group.keys.map(key => visibleTabs.find(t => t.key === key)).filter(Boolean);
            if (!groupTabs.length) return '';
            return `<div class="kasper-more-group" role="presentation">
                <div class="kasper-more-heading">${_calEsc(group.label)}</div>
                ${groupTabs.map(t => tabButtonHtml(t, true)).join('')}
            </div>`;
        }).join('');
        const moreKeys = new Set(KASPER_MORE_GROUPS.flatMap(group => group.keys));
        const activeMoreTab = visibleTabs.find(t => t.key === _kasperState.tab && moreKeys.has(t.key));
        const moreIcon = activeMoreTab ? activeMoreTab.icon : KASPER_MORE_ICON;
        const moreLabel = activeMoreTab ? activeMoreTab.label : 'More';
        return `<div class="kasper-wrap">
            <div class="kasper-head">
                <div class="kasper-title">Kasper</div>
                <div class="kasper-sub">Things waiting for your call.</div>
            </div>
            <nav class="kasper-subtabs" aria-label="Kasper sections">
                ${primaryTabsHtml}
                <div class="kasper-more" onkeydown="_kasperOnMoreKeydown(event)">
                    <button type="button" class="kasper-subtab kasper-more-trigger${activeMoreTab ? ' active' : ''}" data-kasper-more-trigger aria-haspopup="menu" aria-expanded="false" aria-controls="kasperMoreMenu"${activeMoreTab ? ' aria-current="page"' : ''} onclick="_kasperToggleMore(event)">
                        <span class="kasper-more-icon" data-kasper-more-icon aria-hidden="true">${moreIcon}</span>
                        <span data-kasper-more-label>${_calEsc(moreLabel)}</span>
                        <span class="kasper-tab-count kasper-more-count" data-kasper-more-count hidden aria-label="notifications"></span>
                        ${KASPER_MORE_CHEVRON}
                    </button>
                    <div class="kasper-more-menu" id="kasperMoreMenu" role="menu" aria-label="More Kasper sections" hidden>
                        ${moreGroupsHtml}
                    </div>
                </div>
            </nav>
            <div id="kasperContent"></div>
            <div class="kasper-lightbox" id="kasperLightbox" onclick="_kasperCloseLightbox()">
                <img alt="" onclick="event.stopPropagation()">
                <button class="kasper-lightbox-close" type="button" onclick="_kasperCloseLightbox()" aria-label="Close"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
            </div>
        </div>`;
    }

    let _kasperMoreWired = false;
    function _kasperVisibleMoreItems() {
        return [...document.querySelectorAll('#kasperMoreMenu .kasper-more-item:not([hidden])')];
    }
    function _kasperSetMoreOpen(open, focusMenu, restoreTrigger) {
        const wrap = document.querySelector('.kasper-more');
        const trigger = document.querySelector('[data-kasper-more-trigger]');
        const menu = document.getElementById('kasperMoreMenu');
        if (!wrap || !trigger || !menu) return;
        const shouldOpen = !!open;
        wrap.classList.toggle('open', shouldOpen);
        trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        menu.hidden = !shouldOpen;
        const items = _kasperVisibleMoreItems();
        if (!shouldOpen) {
            items.forEach(item => { item.tabIndex = -1; });
            if (restoreTrigger) trigger.focus();
            return;
        }
        if (focusMenu && items.length) {
            const target = items.find(item => item.getAttribute('aria-current') === 'page') || items[0];
            items.forEach(item => { item.tabIndex = item === target ? 0 : -1; });
            target.focus();
        }
    }
    function _kasperToggleMore(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        const trigger = document.querySelector('[data-kasper-more-trigger]');
        _kasperSetMoreOpen(!trigger || trigger.getAttribute('aria-expanded') !== 'true', false, false);
    }
    function _kasperFocusMoreItem(items, index) {
        if (!items.length) return;
        const next = (index + items.length) % items.length;
        items.forEach((item, itemIndex) => { item.tabIndex = itemIndex === next ? 0 : -1; });
        items[next].focus();
    }
    function _kasperOnMoreKeydown(event) {
        if (!event) return;
        const key = event.key;
        const trigger = event.target.closest && event.target.closest('[data-kasper-more-trigger]');
        const menu = document.getElementById('kasperMoreMenu');
        const items = _kasperVisibleMoreItems();
        if (trigger && (key === 'Enter' || key === ' ')) {
            event.preventDefault();
            _kasperSetMoreOpen(true, true, false);
            return;
        }
        if (trigger && (key === 'ArrowDown' || key === 'ArrowUp')) {
            event.preventDefault();
            _kasperSetMoreOpen(true, false, false);
            _kasperFocusMoreItem(items, key === 'ArrowUp' ? items.length - 1 : 0);
            return;
        }
        if (!menu || menu.hidden || !menu.contains(event.target)) return;
        const current = items.indexOf(event.target.closest('.kasper-more-item'));
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            event.preventDefault();
            _kasperFocusMoreItem(items, current + (key === 'ArrowDown' ? 1 : -1));
        } else if (key === 'Home' || key === 'End') {
            event.preventDefault();
            _kasperFocusMoreItem(items, key === 'Home' ? 0 : items.length - 1);
        } else if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            _kasperSetMoreOpen(false, false, true);
        } else if (key === 'Tab') {
            _kasperSetMoreOpen(false, false, false);
        }
    }
    function _kasperDismissMore(event) {
        const wrap = document.querySelector('.kasper-more');
        if (wrap && !wrap.contains(event.target)) _kasperSetMoreOpen(false, false, false);
    }
    function _kasperMoreDocumentKeydown(event) {
        const menu = document.getElementById('kasperMoreMenu');
        if (event.key === 'Escape' && menu && !menu.hidden) {
            event.preventDefault();
            _kasperSetMoreOpen(false, false, true);
        }
    }
    function _kasperWireMoreNav() {
        if (_kasperMoreWired) return;
        document.addEventListener('pointerdown', _kasperDismissMore, true);
        document.addEventListener('keydown', _kasperMoreDocumentKeydown);
        _kasperMoreWired = true;
    }
    function _kasperUnwireMoreNav() {
        if (!_kasperMoreWired) return;
        document.removeEventListener('pointerdown', _kasperDismissMore, true);
        document.removeEventListener('keydown', _kasperMoreDocumentKeydown);
        _kasperMoreWired = false;
    }
    function _kasperSyncTabNav() {
        const activeKey = _kasperState.tab;
        document.querySelectorAll('.kasper-subtab[data-kasper-tab]').forEach(button => {
            const active = button.getAttribute('data-kasper-tab') === activeKey;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        const activeMoreTab = KASPER_SUBTABS.find(tab => tab.key === activeKey && !KASPER_PRIMARY_SUBTAB_KEYS.includes(tab.key));
        const trigger = document.querySelector('[data-kasper-more-trigger]');
        if (trigger) {
            const icon = trigger.querySelector('[data-kasper-more-icon]');
            const label = trigger.querySelector('[data-kasper-more-label]');
            if (icon) icon.innerHTML = activeMoreTab ? activeMoreTab.icon : KASPER_MORE_ICON;
            if (label) label.textContent = activeMoreTab ? activeMoreTab.label : 'More';
            trigger.classList.toggle('active', !!activeMoreTab);
            trigger.title = activeMoreTab ? activeMoreTab.label : 'More sections';
            if (activeMoreTab) trigger.setAttribute('aria-current', 'page');
            else trigger.removeAttribute('aria-current');
        }
        _kasperSyncMoreNotificationCount();
        _kasperSetMoreOpen(false, false, false);
    }

    function _kasperOpenLightboxNow(pid) {
        let it = _kasperState.items.find(x => x.post.id === pid), info = null;
        if (it) info = _calDeriveThumbInfo(it.post);
        // Sample cards listed in the Review queue open here too.
        else if (typeof _sxrKasperState === 'object' && _sxrKasperState) {
            it = (_sxrKasperState.items || []).find(x => x && x.post && x.post.id === pid);
            if (it) info = _sxrDeriveThumbInfo(it.post);
        }
        if (!it) return;
        if (!info || !info.url) return;
        const ovl = document.getElementById('kasperLightbox');
        if (!ovl) return;
        const img = ovl.querySelector('img');
        img.src = info.url;
        ovl.classList.add('open');
    }
    function _kasperCloseLightbox() {
        const ovl = document.getElementById('kasperLightbox');
        if (ovl) ovl.classList.remove('open');
    }
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const ovl = document.getElementById('kasperLightbox');
            if (ovl && ovl.classList.contains('open')) _kasperCloseLightbox();
        }
    });

    function mountKasperView() {
        _kasperWireMoreNav();
        _kasperSyncTabNav();
        // Hydrate cached state once per page-load so the very first visit
        // shows last-known cards while the network re-validation is in
        // flight. Subsequent tab switches in the same page reuse the
        // in-memory state.
        if (!_kasperState.lastLoaded) _kasperHydrateCache();
        _kasperRenderTab();
        // Paint every subtab's count from whatever state we already have (review
        // comes straight from the entry cache), then fetch the rest in the
        // background so all the pills show a real number — not the placeholder dot —
        // without the user having to open each tab.
        _kasperRefreshTabCounts();
        _kasperEnsureAllTabCounts();
        _kasperEnsureAutoRefresh();
    }

    /* Background poll for the Kasper review — same cadence as the client
       calendar (30 s) plus a refresh on tab/window focus, so a card the
       SMM just moved to "Kasper Approval" appears here without needing
       Kasper to hit the Refresh button. Only fires while the Kasper view
       is actually mounted and the tab is visible. */
    let _kasperPollTimer = null;
    let _kasperWiredVisibility = false;
    /* Generation counter — bumped on every user mutation so an in-flight
       background load whose response arrives AFTER a click can detect that
       it's stale and skip applying its result. Without this, a poll fired
       just before the user approves a card can finish 200 ms later and
       repaint with the pre-approval state, making the card "snap back". */
    let _kasperLoadGen = 0;
    function _kasperSetLoadGen(value) { _kasperLoadGen = value; }
    let _kasperLastLocalWriteAt = 0;   // last local Kasper action — used to ignore the realtime echo of our own writes
    function _kasperInvalidateInFlightLoad() { _kasperLoadGen++; _kasperLastLocalWriteAt = Date.now(); }
    /* Click-eaten-by-re-render guard. The queue repaints by rebuilding DOM
       (_kasperPaintReview rebuilds the whole list; _kasperRepaintCard replaces a
       card). A background repaint — a realtime echo of ANY client's change, a
       tab-focus refresh, a slow save landing — can fire in the instant Kasper has
       a button pressed, tearing that button out between pointerdown and click so
       the click never registers. "Finish reviewing" then silently no-ops and he
       has to click again. While a pointer is held on a control in the Kasper view
       we defer background repaints and let the existing retry timer catch up the
       moment it's released. A user action's OWN repaint is unaffected: its onclick
       runs only after pointerup, when this flag is already clear. */
    let _kasperPointerHeld = false;
    let _kasperPointerSafetyTimer = null;
    function _kasperOnPointerDown(e) {
        const t = e && e.target;
        if (!t || !t.closest) return;
        // Only guard presses on actual controls inside the queue — those are the
        // clicks a rebuild can swallow. A press on inert text shouldn't freeze
        // live updates.
        if (!t.closest('#kasperContent')) return;
        if (!t.closest('button, a, [onclick], input, label')) return;
        _kasperPointerHeld = true;
        if (_kasperPointerSafetyTimer) clearTimeout(_kasperPointerSafetyTimer);
        // Safety net: a missed pointerup (drag-off, context menu, alert) must
        // never freeze the queue's live updates. Auto-release shortly after.
        _kasperPointerSafetyTimer = setTimeout(_kasperReleasePointer, 1500);
    }
    function _kasperReleasePointer() {
        if (_kasperPointerSafetyTimer) { clearTimeout(_kasperPointerSafetyTimer); _kasperPointerSafetyTimer = null; }
        _kasperPointerHeld = false;
        // No explicit flush here on purpose: any repaint deferred while held armed
        // its own short retry (see the _kasperPointerHeld guards in
        // _kasperPaintReview / _kasperRepaintCard), which catches up now that the
        // flag is clear. Kasper's OWN action repaints immediately anyway — its
        // onclick runs after this pointerup, when the flag is already false — so a
        // blanket repaint-on-every-release would only add a redundant full rebuild
        // (and would clobber the clean-approve fade-out).
    }
    function _kasperIsReviewMounted() {
        return _kasperState.tab === 'review' && !!document.getElementById('kasperContent');
    }
    function _kasperMaybeBackgroundRefresh() {
        if (document.visibilityState === 'hidden') return;
        // Refresh on the Review AND Replies tabs (both mount into #kasperContent).
        // Replies was excluded before, so the inbox stayed frozen until you left
        // the tab and came back — incoming SMM/client replies never arrived live.
        if (!document.getElementById('kasperContent')) return;
        // Samples listed in the Review queue get the same tab-return catch-up:
        // their realtime socket can suspend in a backgrounded tab and miss
        // events, so cards routed to Kasper while he was away need a refetch.
        if (_kasperState.tab === 'review' && typeof _sxrKasperState !== 'undefined' && _sxrKasperState
            && !_sxrKasperState.loading && _kasperSamplesEnabled()
            && typeof _sxrKasperLoadQueue === 'function') {
            const ta = document.activeElement;
            if (!(ta && ta.tagName === 'TEXTAREA' && ta.closest && ta.closest('#kasperContent'))) _sxrKasperLoadQueue();
        }
        if (_kasperState.tab !== 'review' && _kasperState.tab !== 'replies') return;
        if (_kasperState.loading) return;
        // Skip while the user is actively typing in a panel textarea so a
        // background paint doesn't yank focus out of the draft mid-keystroke.
        const a = document.activeElement;
        if (a && a.tagName === 'TEXTAREA' && a.closest && a.closest('#kasperContent')) return;
        // Force a real refetch — the per-client cache otherwise returns up
        // to 5 minutes of stale data, so a tab-switch refresh wouldn't see
        // anything new the SMM did in the meantime.
        _kasperLoadReview(true);
    }
    function _kasperEnsureAutoRefresh() {
        // No periodic poll — visibility/focus/pageshow events are the
        // only refresh triggers, matching the SMM calendar's behaviour.
        // Wasting an n8n execution every 30 s while Kasper has the tab
        // open in the background just to find nothing changed isn't
        // worth it.
        if (!_kasperWiredVisibility) {
            document.addEventListener('visibilitychange', _kasperMaybeBackgroundRefresh);
            window.addEventListener('focus', _kasperMaybeBackgroundRefresh);
            window.addEventListener('pageshow', _kasperMaybeBackgroundRefresh);
            // Click-eaten-by-re-render guard (see _kasperPointerHeld): track a
            // pressed pointer on a queue control so a background repaint can't tear
            // the button out mid-click. Capture phase, so we see the press first.
            document.addEventListener('pointerdown', _kasperOnPointerDown, true);
            document.addEventListener('pointerup', _kasperReleasePointer, true);
            document.addEventListener('pointercancel', _kasperReleasePointer, true);
            _kasperWiredVisibility = true;
        }
        // Under v2 the queue is also live: a realtime subscription pushes a
        // throttled refresh when any calendar_posts row changes, so a card the
        // SMM moves to Kasper Approval appears without waiting for a focus
        // event. Push-only — an idle tab makes no n8n calls. No-op under v1.
        _kasperV2EnsureSubscribed();
        // Same live push for the Samples sub-tab queue (sample_reviews). Self-gates
        // on _sxrReady(), so it's a no-op unless the samples feature is enabled.
        if (typeof _sxrKasperV2EnsureSubscribed === 'function') _sxrKasperV2EnsureSubscribed();
    }
    /* Stop the Kasper background poller + detach its visibility listeners
       when leaving the Kasper page. Mirrors how the TikTok upload tab tears
       its own poller down. Called from navTo() on every navigation away. */
    function _kasperTeardown() {
        _kasperSetMoreOpen(false, false, false);
        _kasperUnwireMoreNav();
        if (_kasperPollTimer) { clearInterval(_kasperPollTimer); _kasperPollTimer = null; }
        if (_kasperWiredVisibility) {
            document.removeEventListener('visibilitychange', _kasperMaybeBackgroundRefresh);
            window.removeEventListener('focus', _kasperMaybeBackgroundRefresh);
            window.removeEventListener('pageshow', _kasperMaybeBackgroundRefresh);
            document.removeEventListener('pointerdown', _kasperOnPointerDown, true);
            document.removeEventListener('pointerup', _kasperReleasePointer, true);
            document.removeEventListener('pointercancel', _kasperReleasePointer, true);
            _kasperWiredVisibility = false;
        }
        _kasperReleasePointer();
        _kasperV2Teardown();
        if (typeof _sxrKasperV2Teardown === 'function') _sxrKasperV2Teardown();
        if (typeof _ccRevTeardown === 'function') _ccRevTeardown('kasper');
    }

    /* Kasper queue realtime (v2). The review queue spans every client, so a
       single channel subscribes to ALL calendar_posts changes and triggers the
       same throttled background refresh the focus/visibility path uses (which
       itself skips when hidden / not on the review tab / mid-typing / already
       loading, and force-refreshes from Supabase — cheap, no n8n). Debounced so
       a burst of row changes (a reorder, a Linear sync) coalesces into one
       refresh. Reuses the shared supabase-js client. Scoped to the Kasper view:
       opened from _kasperEnsureAutoRefresh, torn down in _kasperTeardown. A
       backgrounded tab whose socket suspends and misses events self-heals via
       the existing focus/visibility refresh on return. No-op unless v2 is fully
       configured, so v1 makes zero Supabase calls. */
    let _kasperV2Channel = null;
    let _kasperV2RtTimer = null;
    const KASPER_RT_SELF_ECHO_MS = 5000;
    function _kasperViewBusy() {
        // True while Kasper is actively working: a recent local action (its own
        // realtime echo is still incoming), a save in flight, a draft being
        // written, or a textarea focused. The realtime refresh waits until he's
        // settled so it never reloads thumbnails or drops his caret mid-review.
        if (Date.now() - _kasperLastLocalWriteAt < KASPER_RT_SELF_ECHO_MS) return true;
        const items = (_kasperState && _kasperState.items) || [];
        for (const it of items) {
            if (it._saving && (it._saving.video || it._saving.graphic || it._saving.caption)) return true;
            if (it._drafts && (String(it._drafts.video || '').trim() || String(it._drafts.graphic || '').trim() || String(it._drafts.caption || '').trim() || String(it._drafts.title || '').trim())) return true;
            if (it._replyDraft && String(it._replyDraft).trim()) return true;
        }
        // Reply drafts live on _kasperState.replies (the Replies inbox), NOT on the
        // queue items above — so scan them too, or a realtime refresh can blow away
        // a half-typed reply now that the Replies tab refreshes live.
        const replies = (_kasperState && _kasperState.replies) || [];
        for (const it of replies) {
            if (it._replyDraft && String(it._replyDraft).trim()) return true;
        }
        const a = document.activeElement;
        if (a && a.tagName === 'TEXTAREA' && a.closest && a.closest('#kasperContent')) return true;
        return false;
    }
    async function _kasperV2EnsureSubscribed() {
        if (!_calV2Ready() || _kasperV2Channel) return;
        const client = await _calV2Client();
        if (!client || _kasperV2Channel) return; // re-check: a teardown/second mount may have raced the lib load
        try {
            _kasperV2Channel = client
                .channel('kasper-cal')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_posts' }, () => {
                    if (_kasperV2RtTimer) clearTimeout(_kasperV2RtTimer);
                    _kasperV2RtTimer = setTimeout(function tick() {
                        _kasperV2RtTimer = null;
                        // Don't rebuild the queue (reloads thumbnails + drops the
                        // textarea caret) on Kasper's OWN action echoes or while
                        // he's mid-review. Re-arm until he's settled; a teammate's
                        // change while he's idle still comes through.
                        if (_kasperViewBusy()) { _kasperV2RtTimer = setTimeout(tick, 2000); return; }
                        _kasperMaybeBackgroundRefresh();
                    }, 1500);
                })
                .subscribe();
        } catch (e) {
            console.warn('[Kasper v2] realtime subscribe failed', e);
            _kasperV2Channel = null;
        }
    }
    function _kasperV2Teardown() {
        if (_kasperV2RtTimer) { clearTimeout(_kasperV2RtTimer); _kasperV2RtTimer = null; }
        if (_kasperV2Channel) {
            try {
                if (_calV2ClientObj && typeof _calV2ClientObj.removeChannel === 'function') _calV2ClientObj.removeChannel(_kasperV2Channel);
                else if (typeof _kasperV2Channel.unsubscribe === 'function') _kasperV2Channel.unsubscribe();
            } catch {}
        }
        _kasperV2Channel = null;
    }

    function _kasperHydrateCache() {
        try {
            const raw = localStorage.getItem(KASPER_CACHE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            const stale = !parsed.savedAt || Date.now() - parsed.savedAt > KASPER_CACHE_MAX_AGE_MS;
            // Display state expires after 24h, but a native-acknowledged source
            // repair is durable debt. Hydrate only those repair subsets from an
            // aged cache so a fresh queue load cannot erase them.
            const items = (Array.isArray(parsed.items) ? parsed.items : [])
                .filter(x => x && x.post && x.post.id && (!stale || x.post._writeUiRetrySourceAt));
            for (const it of items) {
                // Reset transient UI state — saving/error flags must not survive a reload.
                it._saving = { video: false, graphic: false, caption: false };
                it._errors = { video: null, graphic: null, caption: null };
                if (typeof it._expanded !== 'boolean') it._expanded = false;
                if (!it._drafts || typeof it._drafts !== 'object') it._drafts = { video: '', graphic: '', caption: '' };
                it._touchedComps = Array.isArray(it._touchedComps) ? new Set(it._touchedComps) : new Set();
                if (!Array.isArray(it.post.comments)) it.post.comments = _calLoadComments(it.post);
                _calMigratePostShape(it.post);
            }
            _kasperState.items = items;
            _kasperState.history = !stale && Array.isArray(parsed.history) ? parsed.history : [];
            _kasperState.dismissed = !stale && parsed.dismissed && typeof parsed.dismissed === 'object' ? parsed.dismissed : {};
            _kasperState.closed = !stale && parsed.closed && typeof parsed.closed === 'object' ? parsed.closed : {};
            _kasperState.smmByClient = !stale && parsed.smmByClient
                ? new Map(parsed.smmByClient)
                : new Map();
            _kasperState.sxrRepairs = Array.isArray(parsed.sxrRepairs) ? parsed.sxrRepairs : [];
            _kasperState.lastLoaded = stale ? 0 : parsed.savedAt;
        } catch (e) { /* corrupt cache — ignore */ }
    }


    function _kasperGotoTabNow(tab) {
        tab = _kasperResolveSubtab(tab);
        if (!tab) return;
        _kasperPendingSubtab = '';
        if (tab === 'time-off' && !_ptoEnabled()) return;
        if (tab === 'time-off' && !_syncviewStaffCan('pto-admin')) return;
        if (tab === 'client-credentials' && !_syncviewStaffCan('credentials')) { _syncviewOfferStaffSignIn('credentials'); return; }
        if (tab === 'onboarding' && !_syncviewStaffCan('onboarding')) { _syncviewOfferStaffSignIn('onboarding'); return; }
        if (tab === 'hiring-process' && !_syncviewStaffCan('hiring')) { _syncviewOfferStaffSignIn('hiring'); return; }
        if (tab === 'quiz-leads' && !_syncviewStaffCan('quiz-leads')) { _syncviewOfferStaffSignIn('quiz-leads'); return; }
        if (tab === 'clients' && !_syncviewStaffCan('clients-admin')) { _syncviewOfferStaffSignIn('clients-admin'); return; }
        if (tab === 'save-problems' && !_syncviewStaffCan('clients-admin')) { _syncviewOfferStaffSignIn('clients-admin'); return; }
        if (tab === 'time-off') {
            _ptoInvalidateOverviewCaches();
        }
        const returnFocusToMore = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.kasper-more-item'));
        _kasperSetMoreOpen(false, false, false);
        _kasperState.tab = tab;
        try { localStorage.setItem(KASPER_SUBTAB_KEY, tab); } catch (e) {}
        try { history.replaceState({ nav: 'kasper' }, '', '/' + svRoute.search() + '#kasper' + (tab === 'review' ? '' : '/' + tab)); } catch {}
        _kasperSyncTabNav();
        _kasperRenderTab();
        if (returnFocusToMore) {
            const trigger = document.querySelector('[data-kasper-more-trigger]');
            if (trigger) trigger.focus();
        }
    }

    function _kasperRenderTab() {
        if (_kasperState.tab === 'time-off' && !_ptoEnabled()) _kasperFallbackToReview();
        if (_kasperState.tab === 'time-off' && !_syncviewStaffCan('pto-admin')) _kasperFallbackToReview();
        if (_kasperState.tab === 'client-credentials' && !_syncviewStaffCan('credentials')) {
            _kasperDenySubtab('credentials');
        }
        if (_kasperState.tab === 'onboarding' && !_syncviewStaffCan('onboarding')) {
            _kasperDenySubtab('onboarding');
        }
        if (_kasperState.tab === 'hiring-process' && !_syncviewStaffCan('hiring')) {
            _kasperDenySubtab('hiring');
        }
        if (_kasperState.tab === 'quiz-leads' && !_syncviewStaffCan('quiz-leads')) {
            _kasperDenySubtab('quiz-leads');
        }
        if (_kasperState.tab === 'clients' && !_syncviewStaffCan('clients-admin')) {
            _kasperDenySubtab('clients-admin');
        }
        if (_kasperState.tab === 'save-problems' && !_syncviewStaffCan('clients-admin')) {
            _kasperDenySubtab('clients-admin');
        }
        _kasperSyncTabNav();
        // Only the review queue holds the analytics extras back (see _analyticsHoldExtras).
        if (_kasperState.tab !== 'review' && typeof _analyticsReleaseExtras === 'function') _analyticsReleaseExtras();
        if (_kasperState.tab === 'review')  return _kasperRenderReview();
        if (_kasperState.tab === 'replies') return _kasperRenderReplies();
        if (_kasperState.tab === 'editors') return _kasperRenderEditors();
        if (_kasperState.tab === 'filming') return _kasperRenderFilming();
        if (_kasperState.tab === 'time-off') return _ptoRenderAdmin();
        if (_kasperState.tab === 'sales-intake') return _kasperRenderSalesIntake();
        if (_kasperState.tab === 'hiring-process') return _kasperRenderHiringProcess();
        if (_kasperState.tab === 'onboarding') return _kasperRenderOnboarding();
        if (_kasperState.tab === 'client-credentials') return _ccKasperRender();
        if (_kasperState.tab === 'ad-performance') return _kasperRenderAdPerformance();
        if (_kasperState.tab === 'quiz-leads') return _kasperRenderQuizLeads();
        if (_kasperState.tab === 'clients') return _caRender();
        if (_kasperState.tab === 'save-problems') return _spRender();
    }

    // Kasper Ad Performance: read-only summary of Meta spend + iClosed
    // bookings for Kasper's own prospecting campaign, broken out by day, by
    // ad, and per-lead HubSpot funnel status. Staff-authenticated GET against
    // kasper-ad-performance-read; an n8n workflow writes the underlying
    // tables twice a day. This panel never writes anything. The date-range
    // toggle recomputes CPC/conversion-rate/cost-per-booking client-side over
    // just the visible rows (mirroring the Edge Function's own formulas
    // exactly) so switching ranges needs no extra fetch.
    const KASPER_AD_PERF_EF_URL = CAL_SUPABASE_URL + '/functions/v1/kasper-ad-performance-read';
    const KASPER_AD_PERF_HUBSPOT_PORTAL = '245312721';
    const KASPER_AD_PERF_RANGE_KEY = 'syncview_kasper_ad_perf_range_v1';
    const KASPER_AD_PERF_CAMPAIGN_KEY = 'syncview_kasper_ad_perf_campaign_v1';
    const KASPER_AD_PERF_RANGES = [
        { key: '7d', label: '7d', days: 7 },
        { key: '14d', label: '14d', days: 14 },
        { key: '30d', label: '30d', days: 30 },
        { key: 'all', label: 'All', days: null },
    ];
    const _kadState = { loading: false, loaded: false, error: null, rows: [], byAd: [], leads: [], unfinishedLeads: [], campaignDaily: [], campaigns: [], campaign: 'all', chart: null, range: 'all' };
    try {
        const _kadSavedRange = localStorage.getItem(KASPER_AD_PERF_RANGE_KEY);
        if (_kadSavedRange && KASPER_AD_PERF_RANGES.some(r => r.key === _kadSavedRange)) _kadState.range = _kadSavedRange;
        try {
            const savedCampaign = localStorage.getItem(KASPER_AD_PERF_CAMPAIGN_KEY);
            if (savedCampaign) _kadState.campaign = savedCampaign;
        } catch (e) {}
    } catch (e) {}

    function _kasperRenderAdPerformance() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        root.innerHTML = '<div class="kad-wrap"><div class="kad-card-head"><div><div class="kad-card-title">Ad Performance</div><div class="kad-card-sub">Meta spend and iClosed bookings for the prospecting campaign. Updates twice daily.</div></div><button class="kad-refresh" type="button" onclick="_kadLoad(false)">Refresh</button></div><div id="kadBody" class="kad-wrap"></div></div>';
        _kadPaint();
        if (!_kadState.loaded && !_kadState.loading) _kadLoad(false);
        else if (_kadState.loaded && !_kadState.loading) _kadLoad(true);
    }

    async function _kadLoad(background) {
        if (_kadState.loading) return;
        _kadState.loading = true;
        if (!background) { _kadState.error = null; _kadPaint(); }
        try {
            const resp = await fetch(KASPER_AD_PERF_EF_URL, { headers: _syncviewEfHeaders({}, KASPER_AD_PERF_EF_URL) });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + resp.status));
            _kadState.rows = Array.isArray(data.rows) ? data.rows : [];
            _kadState.byAd = Array.isArray(data.by_ad) ? data.by_ad : [];
            _kadState.leads = Array.isArray(data.leads) ? data.leads : [];
            _kadState.unfinishedLeads = Array.isArray(data.unfinished_leads) ? data.unfinished_leads : [];
            _kadState.campaignDaily = Array.isArray(data.campaign_daily) ? data.campaign_daily : [];
            _kadState.campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
            // A selected campaign that no longer exists in the data would silently
            // show an empty panel, so fall back to All rather than stay on it.
            if (_kadState.campaign !== 'all' && !_kadState.campaigns.some(c => c.campaign_id === _kadState.campaign)) _kadState.campaign = 'all';
            _kadState.loaded = true;
        } catch (e) {
            _kadState.error = e && e.message ? e.message : String(e);
        } finally {
            _kadState.loading = false;
            _kadPaint();
        }
    }

    function _kadFmtMoney(n) { return n == null ? '—' : ('$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
    function _kadFmtPct(n) { return n == null ? '—' : ((n * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'); }
    function _kadFmtNum(n) { return n == null ? '—' : Number(n).toLocaleString(); }
    function _kadFmtDate(d) { if (!d) return '—'; const dt = new Date(d + 'T00:00:00Z'); return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

    function _kadCardHtml(label, value, sub) {
        return '<div class="kad-card kad-stat"><div class="kad-stat-label">' + _calEsc(label) + '</div><div class="kad-stat-value">' + _calEsc(value) + '</div>' + (sub ? '<div class="kad-stat-sub">' + _calEsc(sub) + '</div>' : '') + '</div>';
    }

    // Guards every division below: 0/0 must render as "no data yet" (null),
    // never NaN/Infinity — mirrors the Edge Function's safeDivide exactly,
    // since this recomputes the same formulas over a client-selected range
    // instead of refetching.
    function _kadSafeDivide(numerator, denominator) { return denominator > 0 ? numerator / denominator : null; }

    function _kadRangeCutoff() {
        const range = KASPER_AD_PERF_RANGES.find(r => r.key === _kadState.range) || KASPER_AD_PERF_RANGES[KASPER_AD_PERF_RANGES.length - 1];
        if (!range.days) return null;
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - (range.days - 1));
        return cutoff.toISOString().slice(0, 10);
    }

    // 'all' reads kasper_ad_performance_daily, the whole-account rollup that
    // predates multi-campaign and so carries the full history unbroken. A named
    // campaign reads kasper_ad_campaign_daily instead, which is keyed per
    // campaign per day. Both expose the same field names, so everything
    // downstream (summary cards, chart) is unchanged either way.
    function _kadRowsInRange() {
        const cutoff = _kadRangeCutoff();
        const source = _kadState.campaign === 'all'
            ? _kadState.rows
            : _kadState.campaignDaily.filter(r => r.campaign_id === _kadState.campaign);
        return cutoff ? source.filter(r => r.date >= cutoff) : source;
    }

    function _kadSetCampaign(id) {
        _kadState.campaign = id;
        try { localStorage.setItem(KASPER_AD_PERF_CAMPAIGN_KEY, id); } catch (e) {}
        _kadPaint();
    }

    function _kadCampaignLabel(id) {
        const hit = _kadState.campaigns.find(c => c.campaign_id === id);
        return hit ? hit.campaign_name : id;
    }

    function _kadCampaignToggleHtml() {
        // One campaign is the normal case for most of this account's life - a
        // selector with a single option is noise, so it only renders once there
        // is genuinely something to choose between. A dropdown rather than a
        // button row: once the account passed a handful of campaigns the tab
        // row overflowed the toolbar and got visually clipped (owner report,
        // 2026-09-09). Uses the shared sv-select primitive rather than a native
        // <select> - UI_DESIGN_STANDARDS.md requires it on branded surfaces
        // (native popups can't carry SyncView's keyboard/theme/tooltip/mobile
        // states); _svSelectPick dispatches a real change event on the hidden
        // input, so the same this.value onchange contract applies.
        if (_kadState.campaigns.length < 2) return '';
        const items = [{ value: 'all', label: 'All campaigns' }].concat(
            _kadState.campaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name }))
        );
        return _svSelectHtml('kadCampaignSelect', items, _kadState.campaign, 'Choose campaign', { onchange: '_kadSetCampaign(this.value)' });
    }

    function _kadSummarizeRows(rows) {
        const totals = rows.reduce((acc, r) => ({
            spend: acc.spend + Number(r.spend || 0),
            impressions: acc.impressions + Number(r.impressions || 0),
            clicks: acc.clicks + Number(r.clicks || 0),
            landing_page_views: acc.landing_page_views + Number(r.landing_page_views || 0),
            bookings_all: acc.bookings_all + Number(r.bookings_all || 0),
            bookings_held: acc.bookings_held + Number(r.bookings_held || 0),
        }), { spend: 0, impressions: 0, clicks: 0, landing_page_views: 0, bookings_all: 0, bookings_held: 0 });
        return {
            ...totals,
            cpc: _kadSafeDivide(totals.spend, totals.clicks),
            landing_page_view_rate: _kadSafeDivide(totals.landing_page_views, totals.clicks),
            conversion_rate: _kadSafeDivide(totals.bookings_all, totals.landing_page_views),
            cost_per_booking_all: _kadSafeDivide(totals.spend, totals.bookings_all),
            cost_per_booking_held: _kadSafeDivide(totals.spend, totals.bookings_held),
        };
    }

    function _kadSetRange(key) {
        _kadState.range = key;
        try { localStorage.setItem(KASPER_AD_PERF_RANGE_KEY, key); } catch (e) {}
        _kadPaint();
    }

    function _kadRangeToggleHtml() {
        return '<div class="kad-range-toggle" role="group" aria-label="Date range">' + KASPER_AD_PERF_RANGES.map(r =>
            '<button type="button" class="kad-range-btn' + (r.key === _kadState.range ? ' active' : '') + '" onclick="_kadSetRange(\'' + r.key + '\')">' + _calEsc(r.label) + '</button>'
        ).join('') + '</div>';
    }

    function _kadByAdInRange() {
        const cutoff = _kadRangeCutoff();
        const scoped = _kadState.campaign === 'all'
            ? _kadState.byAd
            : _kadState.byAd.filter(r => r.campaign_id === _kadState.campaign);
        const rows = cutoff ? scoped.filter(r => r.date >= cutoff) : scoped;
        const byName = new Map();
        rows.forEach(r => {
            const key = r.ad_name || '(no ad tag)';
            if (!byName.has(key)) byName.set(key, { ad_name: key, spend: 0, clicks: 0, impressions: 0, landing_page_views: 0, bookings_all: 0, bookings_held: 0 });
            const bucket = byName.get(key);
            bucket.spend += Number(r.spend || 0);
            bucket.clicks += Number(r.clicks || 0);
            bucket.impressions += Number(r.impressions || 0);
            bucket.landing_page_views += Number(r.landing_page_views || 0);
            bucket.bookings_all += Number(r.bookings_all || 0);
            bucket.bookings_held += Number(r.bookings_held || 0);
        });
        return Array.from(byName.values()).map(r => ({
            ...r,
            cpc: _kadSafeDivide(r.spend, r.clicks),
            cost_per_booking_all: _kadSafeDivide(r.spend, r.bookings_all),
        })).sort((a, b) => {
            const aRank = a.cost_per_booking_all == null ? Infinity : a.cost_per_booking_all;
            const bRank = b.cost_per_booking_all == null ? Infinity : b.cost_per_booking_all;
            return aRank - bRank || b.spend - a.spend;
        });
    }

    function _kadByAdTableHtml() {
        const ads = _kadByAdInRange();
        if (!ads.length) return '<div class="kasper-empty"><div class="kasper-empty-sub">No ad-level data in this range yet.</div></div>';
        const rows = ads.map(a => '<tr><td>' + _calEsc(a.ad_name) + '</td><td>' + _kadFmtMoney(a.spend) + '</td><td>' + _kadFmtNum(a.clicks) + '</td><td>' + _kadFmtMoney(a.cpc) + '</td><td>' + _kadFmtNum(a.bookings_all) + '</td><td>' + _kadFmtMoney(a.cost_per_booking_all) + '</td></tr>').join('');
        return '<div class="kad-table-scroll-cue">Swipe sideways to view all columns →</div><div class="kad-table-scroll" tabindex="0" aria-label="Ad breakdown; scroll horizontally to view all columns"><table class="kad-table"><thead><tr><th>Ad</th><th>Spend</th><th>Clicks</th><th>CPC</th><th>Bookings</th><th>Cost / booking</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function _kadLeadsInRange() {
        const cutoff = _kadRangeCutoff();
        return cutoff ? _kadState.leads.filter(l => l.booked_date >= cutoff) : _kadState.leads;
    }

    function _kadLeadStatusHtml(lead) {
        const stage = lead.hubspot_lifecyclestage;
        const tone = stage === 'customer' ? 'kad-lead-won' : (lead.iclosed_status === 'disqualified' ? 'kad-lead-lost' : 'kad-lead-open');
        const label = stage === 'customer' ? 'Customer' : (lead.iclosed_status ? (lead.iclosed_status.charAt(0).toUpperCase() + lead.iclosed_status.slice(1)) : (stage || 'Unknown'));
        return '<span class="kad-lead-status ' + tone + '">' + _calEsc(label) + '</span>' + (lead.cancelled ? ' <span class="kad-lead-cancelled">cancelled</span>' : '');
    }

    function _kadLeadsListHtml() {
        const leads = _kadLeadsInRange();
        if (!leads.length) return '<div class="kasper-empty"><div class="kasper-empty-sub">No booked leads in this range yet.</div></div>';
        const rows = leads.map(l => {
            const hubspotUrl = l.hubspot_contact_id ? ('https://app.hubspot.com/contacts/' + KASPER_AD_PERF_HUBSPOT_PORTAL + '/record/0-1/' + encodeURIComponent(l.hubspot_contact_id)) : '';
            const nameCell = hubspotUrl
                ? '<a href="' + _calEsc(hubspotUrl) + '" target="_blank" rel="noopener">' + _calEsc(l.lead_name) + '</a>'
                : _calEsc(l.lead_name);
            return '<tr><td>' + _kadFmtDate(l.booked_date) + '</td><td>' + nameCell + '</td><td><a href="mailto:' + _calEsc(l.lead_email) + '">' + _calEsc(l.lead_email) + '</a></td><td>' + _calEsc(l.ad_name || '—') + '</td><td>' + _calEsc(l.campaign_name || '—') + '</td><td>' + _kadLeadStatusHtml(l) + '</td></tr>';
        }).join('');
        return '<div class="kad-table-scroll-cue">Swipe sideways to view all columns →</div><div class="kad-table-scroll" tabindex="0" aria-label="Booked leads; scroll horizontally to view all columns"><table class="kad-table"><thead><tr><th>Booked</th><th>Name</th><th>Email</th><th>Ad</th><th>Campaign</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function _kadUnfinishedLeadsInRange() {
        const cutoff = _kadRangeCutoff();
        return cutoff ? _kadState.unfinishedLeads.filter(l => l.captured_at.slice(0, 10) >= cutoff) : _kadState.unfinishedLeads;
    }

    function _kadUnfinishedLeadStatusHtml(lead) {
        const label = lead.iclosed_status ? (lead.iclosed_status.charAt(0).toUpperCase() + lead.iclosed_status.slice(1)) : 'Unknown';
        return '<span class="kad-lead-status kad-lead-open">' + _calEsc(label) + '</span>';
    }

    function _kadUnfinishedLeadFollowUpHtml(lead) {
        // Every non-finisher now gets BOTH channels when we hold an email and
        // a phone (owner decision, 2026-09-04) - email_sent_at and
        // sms_sent_at can both be set on the same lead. The old chain
        // returned on the first truthy channel, so a lead who got an email
        // AND a text only ever showed "Email sent", silently hiding the text
        // (owner report, 2026-09-09). Report each channel that applies to
        // this lead independently instead of first-match-wins.
        const dueDate = lead.follow_up_due_at ? _kadFmtDate(lead.follow_up_due_at.slice(0, 10)) : null;
        const parts = [];
        if (lead.email) {
            parts.push(lead.email_sent_at
                ? '<span class="kad-lead-status kad-lead-won">Email sent</span> ' + _kadFmtDate(lead.email_sent_at.slice(0, 10))
                : (dueDate ? '<span class="kad-lead-status kad-lead-open">Email due</span> ' + dueDate : '<span class="kad-lead-cancelled">Email pending</span>'));
        }
        if (lead.phone) {
            parts.push(lead.sms_sent_at
                ? '<span class="kad-lead-status kad-lead-won">Text sent</span> ' + _kadFmtDate(lead.sms_sent_at.slice(0, 10))
                : (dueDate ? '<span class="kad-lead-status kad-lead-open">Text due</span> ' + dueDate : '<span class="kad-lead-cancelled">Text pending</span>'));
        }
        return parts.length ? parts.join('<br>') : '<span class="kad-lead-cancelled">—</span>';
    }

    function _kadUnfinishedLeadsListHtml() {
        const leads = _kadUnfinishedLeadsInRange();
        if (!leads.length) return '<div class="kasper-empty"><div class="kasper-empty-sub">No unfinished leads in this range.</div></div>';
        const rows = leads.map(l => {
            const name = ((l.first_name || '') + ' ' + (l.last_name || '')).trim() || '(no name)';
            const emailCell = l.email ? '<a href="mailto:' + _calEsc(l.email) + '">' + _calEsc(l.email) + '</a>' : '—';
            const phoneCell = l.phone ? '<a href="tel:' + _calEsc(l.phone) + '">' + _calEsc(l.phone) + '</a>' : '—';
            return '<tr><td>' + _kadFmtDate(l.captured_at.slice(0, 10)) + '</td><td>' + _calEsc(name) + '</td><td>' + emailCell + '</td><td>' + phoneCell + '</td><td>' + _calEsc(l.campaign_name || '—') + '</td><td>' + _kadUnfinishedLeadStatusHtml(l) + '</td><td>' + _kadUnfinishedLeadFollowUpHtml(l) + '</td></tr>';
        }).join('');
        return '<div class="kad-table-scroll-cue">Swipe sideways to view all columns →</div><div class="kad-table-scroll" tabindex="0" aria-label="Unfinished leads; scroll horizontally to view all columns"><table class="kad-table"><thead><tr><th>Captured</th><th>Name</th><th>Email</th><th>Phone</th><th>Campaign</th><th>Status</th><th>Follow-up</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function _kadPaint() {
        const body = document.getElementById('kadBody');
        if (!body) return;
        if (_kadState.loading && !_kadState.loaded) { body.innerHTML = _calLoaderHtml('Loading ad performance'); return; }
        if (_kadState.error && !_kadState.loaded) {
            body.innerHTML = '<div class="kasper-empty"><div class="kasper-empty-title">Could not load ad performance</div><div class="kasper-empty-sub">' + _calEsc(_kadState.error) + '</div><button class="kad-refresh" type="button" onclick="_kadLoad(false)">Try again</button></div>';
            return;
        }
        if (!_kadState.loaded || !_kadState.rows.length) {
            body.innerHTML = '<div class="kasper-empty"><div class="kasper-empty-title">No data yet</div><div class="kasper-empty-sub">The n8n pull writes here twice a day — check back after the next run.</div></div>';
            return;
        }
        const rangeRows = _kadRowsInRange();
        const summary = _kadSummarizeRows(rangeRows);
        const cards = [
            _kadCardHtml('Total spend', _kadFmtMoney(summary.spend)),
            _kadCardHtml('Cost per click', _kadFmtMoney(summary.cpc)),
            _kadCardHtml('Landing page views', _kadFmtNum(summary.landing_page_views), _kadFmtPct(summary.landing_page_view_rate) + ' of clicks'),
            _kadCardHtml('Conversion rate', _kadFmtPct(summary.conversion_rate), 'landing page views → booked calls'),
            _kadCardHtml('Cost per booking (all)', _kadFmtMoney(summary.cost_per_booking_all), summary.bookings_all + ' booked'),
            _kadCardHtml('Cost per booking (held)', _kadFmtMoney(summary.cost_per_booking_held), summary.bookings_held + ' held, excl. cancelled'),
        ].join('');
        const campaignNote = _kadState.campaign === 'all' ? '' : ' Showing <b>' + _calEsc(_kadCampaignLabel(_kadState.campaign)) + '</b>; the lead tables below always show every campaign.';
        body.innerHTML = '<div class="kad-toolbar">' + _kadRangeToggleHtml() + _kadCampaignToggleHtml() + '</div>'
            + '<div class="kad-stats">' + cards + '</div>'
            + '<div class="kad-card full"><div class="kad-section-title">Spend &amp; bookings by day</div><div class="chart-wrap"><canvas id="kadChart"></canvas></div></div>'
            + '<div class="kad-card full"><div class="kad-section-title">By ad</div><div class="kad-section-sub">Sorted by cost per booking (cheapest first); ads with no bookings sort last.</div>' + _kadByAdTableHtml() + '</div>'
            + (campaignNote ? '<div class="kad-section-sub" style="margin:-4px 0 12px">' + campaignNote + '</div>' : '')
            + '<div class="kad-card full"><div class="kad-section-title">Booked leads</div><div class="kad-section-sub">Status and stage come from the matching HubSpot contact. Names link to HubSpot when matched. Never filtered by the campaign selector.</div>' + _kadLeadsListHtml() + '</div>'
            + '<div class="kad-card full"><div class="kad-section-title">Unfinished leads</div><div class="kad-section-sub">Started booking a call but never finished — potential/qualified only, disqualified excluded. Follow-up shows whether the recovery email and text have gone out yet.</div>' + _kadUnfinishedLeadsListHtml() + '</div>';
        _kadRenderChart(rangeRows);
    }

    function _kadRenderChart(rows) {
        const ctx = document.getElementById('kadChart');
        if (!ctx || typeof Chart === 'undefined') return;
        if (_kadState.chart) { _kadState.chart.destroy(); _kadState.chart = null; }
        const spendRgb = _svRgb('--chart-spend');
        _kadState.chart = new Chart(ctx, {
            data: {
                labels: rows.map(r => r.date),
                datasets: [
                    { type: 'bar', label: 'Spend', data: rows.map(r => Number(r.spend || 0)), backgroundColor: `rgba(${spendRgb.r},${spendRgb.g},${spendRgb.b},0.55)`, yAxisID: 'y', order: 2 },
                    { type: 'line', label: 'Bookings', data: rows.map(r => Number(r.bookings_all || 0)), borderColor: _svCss('--up'), backgroundColor: _svCss('--up'), tension: 0.3, yAxisID: 'y1', order: 1 },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { position: 'left', beginAtZero: true, title: { display: true, text: 'Spend ($)' } },
                    y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Bookings' }, ticks: { precision: 0 } },
                },
            },
        });
    }

    // Kasper Quiz Leads: read-only inbox for synchrosocial.com/quiz submissions
    // (Growth Bottleneck Quiz). Staff-authenticated GET against quiz_responses
    // via quiz-leads-list, admin-only (decision log, 2026-08-24) — quiz answers
    // carry less sensitivity than onboarding's stored credentials, but access
    // is scoped the same way the leave-management admin capability is, not
    // opened to every role like the Onboarding inbox. This panel never writes anything.
    // Question labels are a short display-only mirror of the quiz copy in the
    // synchrosocial repo (src/data/growthQuizQuestions.js) — separate repos,
    // so there is no shared source; keep the two in sync by hand if questions
    // change.
    const KASPER_QUIZ_LEADS_EF_URL = CAL_SUPABASE_URL + '/functions/v1/quiz-leads-list';
    const KQL_CATEGORY_LABELS = { reach: 'Reach', positioning: 'Positioning', profile: 'Profile', consistency: 'Consistency' };
    const KQL_QUESTION_LABELS = {
        q1: '% of views from non-followers', q2: 'Hook strength',
        q3: 'Content targets one audience', q4: 'Distinctive point of view',
        q5: 'Profile visits per 1,000 views', q6: 'Profile explains who you help',
        q7: 'Publishing consistency', q8: 'Repurposing per idea',
    };
    const _kqlState = { loading: false, loaded: false, error: null, leads: [], search: '' };

    function _kasperRenderQuizLeads() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        root.innerHTML = '<div class="kql-wrap"><div class="kql-card-head"><div><div class="kql-card-title">Quiz Leads</div><div class="kql-card-sub">Growth Bottleneck Quiz submissions from synchrosocial.com/quiz, newest first.</div></div><button class="kql-refresh" type="button" onclick="_kqlLoad(false)">Refresh</button></div><input type="search" class="kql-search" placeholder="Search name or email" value="' + _calEsc(_kqlState.search) + '" oninput="_kqlFilter(this.value)"><div id="kqlBody"></div></div>';
        _kqlPaint();
        if (!_kqlState.loaded && !_kqlState.loading) _kqlLoad(false);
        else if (_kqlState.loaded && !_kqlState.loading) _kqlLoad(true);
    }

    async function _kqlLoad(background) {
        if (_kqlState.loading) return;
        _kqlState.loading = true;
        if (!background) { _kqlState.error = null; _kqlPaint(); }
        try {
            const resp = await fetch(KASPER_QUIZ_LEADS_EF_URL, { headers: _syncviewEfHeaders({}, KASPER_QUIZ_LEADS_EF_URL) });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + resp.status));
            _kqlState.leads = Array.isArray(data.leads) ? data.leads : [];
            _kqlState.loaded = true;
        } catch (e) {
            _kqlState.error = e && e.message ? e.message : String(e);
        } finally {
            _kqlState.loading = false;
            _kqlPaint();
        }
    }

    function _kqlFilter(value) {
        _kqlState.search = value || '';
        const needle = _kqlState.search.trim().toLowerCase();
        document.querySelectorAll('[data-kql-row]').forEach((row) => {
            const hay = row.getAttribute('data-kql-search') || '';
            row.style.display = !needle || hay.indexOf(needle) !== -1 ? '' : 'none';
        });
    }

    function _kqlToggle(id) {
        const detail = document.getElementById('kql-detail-' + id);
        if (detail) detail.hidden = !detail.hidden;
    }

    function _kqlInjectStyles() {
        if (document.getElementById('kqlStyles')) return;
        const style = document.createElement('style');
        style.id = 'kqlStyles';
        style.textContent = '.kql-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}' +
            '.kql-card-title{color:var(--text-primary);font-size:0.9rem;font-weight:800;letter-spacing:-0.015em}' +
            '.kql-card-sub{margin-top:4px;color:var(--text-muted);font-size:0.68rem;line-height:1.45}' +
            '.kql-refresh{min-height:36px;border:1px solid var(--border);border-radius:10px;padding:8px 13px;background:var(--white);color:var(--text-secondary);font:inherit;font-size:0.72rem;font-weight:750;cursor:pointer}' +
            '.kql-refresh:hover{border-color:var(--text-muted);color:var(--text-primary)}' +
            '.kql-refresh:disabled{opacity:0.55;cursor:wait}' +
            '.kql-search{width:100%;max-width:360px;height:34px;margin:12px 0;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit}' +
            '.kql-stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}' +
            '.kql-stat{padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2)}' +
            '.kql-stat b{font-size:16px}' +
            '.kql-row{border:1px solid var(--border);border-radius:8px;margin-bottom:8px;overflow:hidden}' +
            '.kql-row-head{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 12px;background:none;border:0;text-align:left;cursor:pointer;color:inherit;font:inherit}' +
            '.kql-row-head:hover{background:var(--surface-2)}' +
            '.kql-row-name{font-weight:600}' +
            '.kql-row-sub{font-size:12px;color:var(--text-2)}' +
            '.kql-badge{padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600;background:var(--surface-2);color:var(--accent)}' +
            '.kql-detail{padding:10px 12px 14px;border-top:1px solid var(--border)}' +
            '.kql-qa{display:grid;grid-template-columns:1fr auto;gap:4px 10px;font-size:13px;margin-bottom:10px}' +
            '.kql-qa div:nth-child(odd){color:var(--text-2)}' +
            '.kql-attr{font-size:12px;color:var(--text-2)}';
        document.head.appendChild(style);
    }

    function _kqlSummaryHtml(leads) {
        const counts = { reach: 0, positioning: 0, profile: 0, consistency: 0 };
        leads.forEach((l) => { if (counts[l.result_category] !== undefined) counts[l.result_category]++; });
        const stats = ['<div class="kql-stat">Total<br><b>' + leads.length + '</b></div>']
            .concat(Object.keys(KQL_CATEGORY_LABELS).map((k) =>
                '<div class="kql-stat">' + _calEsc(KQL_CATEGORY_LABELS[k]) + '<br><b>' + counts[k] + '</b></div>'));
        return '<div class="kql-stats">' + stats.join('') + '</div>';
    }

    function _kqlRowHtml(lead) {
        const id = _calEsc(lead.response_id);
        const search = ((lead.contact_name || '') + ' ' + (lead.contact_email || '')).toLowerCase();
        const category = KQL_CATEGORY_LABELS[lead.result_category] || lead.result_category || '—';
        const when = lead.created_at ? new Date(lead.created_at).toLocaleString() : '';
        const qa = Object.keys(KQL_QUESTION_LABELS).map((q) => {
            const val = lead.answers && lead.answers[q];
            if (val == null) return '';
            return '<div>' + _calEsc(KQL_QUESTION_LABELS[q]) + '</div><div>' + _calEsc(String(val)) + '/5</div>';
        }).join('');
        const attrFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'referrer'];
        const attr = attrFields.filter((f) => lead[f]).map((f) => f + '=' + lead[f]).join(' · ');
        return '<div class="kql-row" data-kql-row data-kql-search="' + _calEsc(search) + '">' +
            '<button type="button" class="kql-row-head" onclick="_kqlToggle(\'' + id + '\')">' +
            '<span><span class="kql-row-name">' + _calEsc(lead.contact_name || '(no name)') + '</span> · ' + _calEsc(lead.contact_email || '') +
            '<div class="kql-row-sub">' + _calEsc(when) + (lead.headline_variant && lead.headline_variant !== 'control' ? ' · headline: ' + _calEsc(lead.headline_variant) : '') + '</div></span>' +
            '<span class="kql-badge">' + _calEsc(category) + '</span></button>' +
            '<div class="kql-detail" id="kql-detail-' + id + '" hidden>' +
            (qa ? '<div class="kql-qa">' + qa + '</div>' : '') +
            (attr ? '<div class="kql-attr">' + _calEsc(attr) + '</div>' : '<div class="kql-attr">No ad attribution on this session (direct/organic).</div>') +
            '</div></div>';
    }

    function _kqlPaint() {
        _kqlInjectStyles();
        const body = document.getElementById('kqlBody');
        if (!body) return;
        if (_kqlState.loading && !_kqlState.loaded) { body.innerHTML = _calLoaderHtml('Loading quiz leads'); return; }
        if (_kqlState.error && !_kqlState.loaded) {
            body.innerHTML = '<div class="kasper-empty"><div class="kasper-empty-title">Could not load quiz leads</div><div class="kasper-empty-sub">' + _calEsc(_kqlState.error) + '</div><button class="kql-refresh" type="button" onclick="_kqlLoad(false)">Try again</button></div>';
            return;
        }
        if (!_kqlState.leads.length) {
            body.innerHTML = '<div class="kasper-empty"><div class="kasper-empty-title">No quiz leads yet</div><div class="kasper-empty-sub">Submissions from /quiz will show up here once the funnel is live.</div></div>';
            return;
        }
        body.innerHTML = _kqlSummaryHtml(_kqlState.leads) + _kqlState.leads.map(_kqlRowHtml).join('');
        _kqlFilter(_kqlState.search);
    }

    /* SAVE PROBLEMS (OPEN_REPAIRS 101 release A, session Sentinel, 2026-09-27).
     *
     * Admin-only, read-only list of refused or failed saves from the server
     * refusal log: when, which screen and action, client link or staff page
     * (with the VERIFIED staff role when there is one), which card, the error
     * code and its cleaned message, browser and app version. Our own automated
     * tests are hidden unless asked for. A client link shows only as the start
     * of its one-way hash, so rows from one client group together without
     * naming anyone. Nothing here writes. */
    const SP_EF_URL = CAL_SUPABASE_URL + '/functions/v1/write-diagnostics';
    const SP_SCREENS = { calendar: 'Calendar', sxr: 'Samples', production: 'Production', unknown: 'Unknown' };
    const SP_PAGES = { client_link: 'Client link', staff_page: 'Staff', unknown: 'Unknown' };
    const _spState = { days: 7, automation: false, screen: '', page: '', loading: false, loaded: false, error: null, data: null, gen: 0 };
    function _spInjectStyles() {
        if (document.getElementById('spStyles')) return;
        const style = document.createElement('style');
        style.id = 'spStyles';
        style.textContent = '.sp-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;font-size:0.74rem;color:var(--text-secondary)}' +
            '.sp-control{display:inline-flex;align-items:center;gap:6px}.sp-control .sv-select{min-width:150px}' +
            '.sp-summary{margin-bottom:10px;font-size:0.74rem;color:var(--text-muted)}' +
            '.sp-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:10px}' +
            '.sp-table{width:100%;border-collapse:collapse;font-size:0.72rem}' +
            '.sp-table th{position:sticky;top:0;text-align:left;font-weight:750;color:var(--text-secondary);background:var(--surface-2);padding:8px 10px;white-space:nowrap}' +
            '.sp-table td{padding:8px 10px;border-top:1px solid var(--border);vertical-align:top;color:var(--text-primary)}' +
            '.sp-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.68rem}' +
            '.sp-muted{color:var(--text-muted)}' +
            '.sp-detail{max-width:360px;overflow-wrap:anywhere}' +
            '.sp-check{display:inline-flex;align-items:center;gap:6px}' +
            '@media (max-width:767px){.sp-control .sv-select-trigger,.sp-check,.sp-refresh{min-height:44px}.sp-controls input[type=checkbox]{width:22px;height:22px}}';
        document.head.appendChild(style);
    }
    function _spRender() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        if (!_syncviewStaffCan('clients-admin')) { _kasperDenySubtab('clients-admin'); return; }
        _kqlInjectStyles();   // the shared card head and Refresh button
        _spInjectStyles();
        // SyncView dropdowns (UI_DESIGN_STANDARDS: no browser-native selects).
        const items = (pairs) => pairs.map(([value, label]) => ({ value: String(value), label }));
        root.innerHTML = '<div class="kql-wrap"><div class="kql-card-head"><div><div class="kql-card-title">Save problems</div>' +
            '<div class="kql-card-sub">Every refused or failed save that reached the server log, newest first. Kept for 30 days.</div></div>' +
            '<button class="kql-refresh sp-refresh" type="button" data-sp-refresh>Refresh</button></div>' +
            '<div class="sp-controls">' +
            '<span class="sp-control"><span class="sp-control-label">Period</span>' + _svSelectHtml('spDays', items([[1, 'Last 24 hours'], [7, 'Last 7 days'], [30, 'Last 30 days']]), String(_spState.days)) + '</span>' +
            '<span class="sp-control"><span class="sp-control-label">Screen</span>' + _svSelectHtml('spScreen', items([['', 'All screens']].concat(Object.keys(SP_SCREENS).map(k => [k, SP_SCREENS[k]]))), _spState.screen) + '</span>' +
            '<span class="sp-control"><span class="sp-control-label">Who</span>' + _svSelectHtml('spPage', items([['', 'Everyone'], ['client_link', 'Client links'], ['staff_page', 'Staff']]), _spState.page) + '</span>' +
            '<label class="sp-check"><input type="checkbox" data-sp-automation' + (_spState.automation ? ' checked' : '') + '> Show automated tests</label>' +
            '</div><div id="spBody"></div></div>';
        root.querySelector('[data-sp-refresh]').addEventListener('click', () => _spLoad());
        // Every filter asks the server again: filtering a capped page here
        // would hide older rows that match.
        document.getElementById('spDays').addEventListener('change', e => { _spState.days = Number(e.target.value) || 7; _spLoad(); });
        document.getElementById('spScreen').addEventListener('change', e => { _spState.screen = e.target.value; _spLoad(); });
        document.getElementById('spPage').addEventListener('change', e => { _spState.page = e.target.value; _spLoad(); });
        root.querySelector('[data-sp-automation]').addEventListener('change', e => { _spState.automation = !!e.target.checked; _spLoad(); });
        _spPaint();
        _spLoad();
    }
    async function _spLoad() {
        const gen = ++_spState.gen;
        _spState.loading = true; _spState.error = null;
        _spPaint();
        try {
            const ident = _syncviewStaffIdentityForHeaders();
            if (!ident || !ident.key) throw new Error('Sign in as an admin to see save problems.');
            const resp = await fetch(SP_EF_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'X-Syncview-Key': ident.key },
                body: JSON.stringify({ action: 'staff_list', days: _spState.days, include_automation: _spState.automation, surface: _spState.screen || null, page: _spState.page || null })
            });
            const data = await resp.json().catch(() => null);
            if (resp.status === 403) throw new Error('Save problems need an Admin account.');
            if (resp.status === 503 && data && data.error === 'dormant') throw new Error('The save-problem log is switched off on the server.');
            if (!resp.ok || !data || data.ok !== true) throw new Error('Could not read the save-problem log (HTTP ' + resp.status + ').');
            if (gen !== _spState.gen) return;
            _spState.data = data.result || { rows: [] };
            _spState.loaded = true;
        } catch (e) {
            if (gen !== _spState.gen) return;
            _spState.error = e && e.message ? e.message : String(e);
        } finally {
            if (gen === _spState.gen) { _spState.loading = false; _spPaint(); }
        }
    }
    function _spWhen(iso) {
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function _spPaint() {
        const body = document.getElementById('spBody');
        if (!body) return;
        if (_spState.loading && !_spState.loaded) { body.innerHTML = _calLoaderHtml('Loading save problems'); return; }
        if (_spState.error) {
            body.innerHTML = '<div class="kasper-empty"><div class="kasper-empty-title">Could not load save problems</div><div class="kasper-empty-sub">' + _calEsc(_spState.error) + '</div></div>';
            return;
        }
        const data = _spState.data || { rows: [] };
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const hidden = Number(data.hidden_automation) || 0;
        const summary = '<div class="sp-summary">' + _calEsc(String(rows.length)) + ' shown' +
            (Number(data.total) > rows.length ? ' (newest ' + _calEsc(String(rows.length)) + ' of ' + _calEsc(String(data.total)) + ')' : '') +
            (!data.include_automation && hidden ? ' · ' + _calEsc(String(hidden)) + ' automated test rows hidden' : '') + '</div>';
        if (!rows.length) {
            body.innerHTML = summary + '<div class="kasper-empty"><div class="kasper-empty-title">No save problems</div><div class="kasper-empty-sub">Nothing was refused or failed in this period.</div></div>';
            return;
        }
        const who = r => {
            const page = SP_PAGES[r.page] || 'Unknown';
            if (r.page === 'staff_page' && r.staff_role) return page + ' (' + ({ admin: 'Admin', smm: 'SMM', creative: 'Creative' }[r.staff_role] || r.staff_role) + ')';
            if (r.page === 'client_link' && r.client_ref) return page + ' · ' + r.client_ref;
            return page;
        };
        const cell = (v, cls) => '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + (v ? _calEsc(String(v)) : '<span class="sp-muted">-</span>') + '</td>';
        body.innerHTML = summary + '<div class="sp-scroll"><table class="sp-table"><thead><tr><th>When</th><th>Screen</th><th>Action</th><th>Who</th><th>Card</th><th>Error</th><th>Message</th><th>Browser</th><th>App version</th></tr></thead><tbody>' +
            rows.map(r => '<tr>' + cell(_spWhen(r.recorded_at)) + cell(SP_SCREENS[r.surface] || r.surface) + cell(r.ui_action || r.operation) + cell(who(r)) +
                cell(r.card_ref, 'sp-code') + cell((r.code === 'network_failure' ? 'network failure, no status' : (r.code || '') + (r.status ? ' (' + r.status + ')' : '')) + (Number(r.attempts) > 1 ? ' · ' + r.attempts + ' tries' : ''), 'sp-code') + cell(r.detail, 'sp-detail') +
                cell([r.browser, r.os].filter(Boolean).join(' / ')) + cell(r.app_version ? r.app_version.replace('T', ' ') + ' UTC' : '') + '</tr>').join('') +
            '</tbody></table></div>';
    }

    // Sales Intake lives as a Kasper subtab (it's Kasper's post-close paperwork
    // trigger, so it belongs with everything else waiting on him). The form
    // module itself (_si*/SI_*) is defined next to the other page modules —
    // this is just the subtab mount. Background review repaints can't clobber
    // the form: _kasperPaintReview writes into #kasperReviewBody, which doesn't
    // exist while this subtab is showing.
    function _kasperRenderSalesIntake() {
        const el = document.getElementById('kasperContent');
        if (!el) return;
        el.innerHTML = renderSalesIntakeView();
        mountSalesIntakeView();
    }

    function _kasperRenderHiringProcess() {
        const el = document.getElementById('kasperContent');
        if (!el) return;
        if (!_syncviewStaffCan('hiring')) { _kasperDenySubtab('hiring'); return; }
        el.innerHTML = renderHiringProcessView();
        _hpPaint();
        _hpLoadList(false);
    }

    // Onboarding subtab — the full three-section inbox (Standard / AI / Old forms +
    // search), fed by the Kasper-gated onboarding-full edge function so everything is
    // visible: names, emails, phones, and account credentials. _obvMode='full' makes
    // _obvEnsureLoaded call the gated endpoint and the detail render the Account access
    // section. A background review repaint can't clobber this: _kasperPaintReview writes
    // into #kasperReviewBody, which doesn't exist while this subtab is showing.
    function _kasperRenderOnboarding() {
        const el = document.getElementById('kasperContent');
        if (!el) return;
        // The inbox lives in the on-demand Templates area (040, svWithArea).
        svWithArea('templates', el, tpl => {
            tpl.obvSetMode('full');
            if (Array.isArray(tpl.obvSubs())) _kasperMarkOnboardingSeen();
            tpl.obvInjectStyles();
            el.innerHTML = tpl.renderOnboardingInbox();
            tpl.obvEnsureLoaded();
        }, _kasperRenderOnboarding);
    }


    /* ── Client Credentials ─────────────────────────────────────────
       Staff-only credentials source of truth. Requests reuse the verified
       roster identity and role key; no second credentials prompt is shown. */
    const CC_EDGE_URL = CAL_SUPABASE_URL + '/functions/v1/client-credentials';
    const CC_MASK = '••••••';
    const CC_RT_SELF_ECHO_MS = 4500;
    const CC_PLATFORM_OPTIONS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'threads', 'x', 'pinterest', 'website'];
    const CC_ICON_COPY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="7" height="8" rx="1.5"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>';
    const CC_ICON_HISTORY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 5.2a5.3 5.3 0 1 1 .5 6"/><path d="M3 2.5v3h3"/><path d="M8 5.5V8l1.8 1.2"/></svg>';
    const CC_ICON_EDIT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.7 2.7 13.3 5.3 6 12.6l-3.2.6.6-3.2 7.3-7.3Z"/><path d="m9.7 3.7 2.6 2.6"/></svg>';
    const CC_ICON_ARCHIVE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10"/><rect x="3.8" y="4.5" width="8.4" height="8.2" rx="1.5"/><path d="M6.2 7.2h3.6"/></svg>';
    const CC_ICON_X = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>';
    const _ccState = {
        kasper: { credentials: [], loading: false, error: null, loaded: false, search: '' },
        modal: { open: false, client: '', credentials: [], loading: false, error: null, loaded: false },
    };
    const _ccRevealed = new Set();
    // Which client cards are expanded in the Kasper list. Empty = every client
    // collapsed by default (the list opens as a tidy client index); a slug is
    // added when the user opens that card and survives background repaints.
    const _ccExpanded = new Set();
    let _ccRevKasperChannel = null, _ccRevModalChannel = null, _ccRevModalSlug = null;
    let _ccRevKasperTimer = null, _ccRevModalTimer = null;
    let _ccLastLocalWriteAt = 0;

    function _ccKnownClients() { return WL_CLIENT_NAMES.slice().sort((a, b) => a.localeCompare(b)); }
    function _ccClientNameForSlug(slug) { return WL_CLIENT_CANONICAL.get(String(slug || '').replace(/^unmatched:/, '')) || slug || ''; }
    /* Two different states that the header must not conflate (owner report
       2026-08-21: after the onboarding import, every correctly-matched client
       showed as "Unmatched / needs review", which reads as a filing failure).
       UNMATCHED means the row is parked under a slug no client owns -- a real
       problem needing a reassign. NEEDS REVIEW is the deliberate landing state
       of every import: filed correctly, awaiting a human glance. */
    function _ccIsTrulyUnmatched(r) { return String(r.client_slug || '').startsWith('unmatched:'); }
    function _ccIsUnmatched(r) { return _ccIsTrulyUnmatched(r) || r.status === 'needs_review'; }
    function _ccPrettyDate(v) { if (!v) return 'never'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    function _ccPlatformLabel(v) { return String(v || 'account').replace(/[_-]+/g, ' '); }
    function _ccSelectItemsFromValues(values) { return values.map(v => ({ value: v, label: _ccPlatformLabel(v) })); }
    function _ccClientSelectItems(selectedSlug) { return _ccKnownClients().map(n => ({ value: wlNormalizeClient(n) + '|' + n, label: n, active: wlNormalizeClient(n) === selectedSlug })); }
    function _ccFind(id) { return (_ccState.kasper.credentials || []).concat(_ccState.modal.credentials || []).find(r => r.id === id) || null; }
    /* Resolve from the list the person is actually looking at.
       The Kasper store holds every client's rows and the per-client modal holds
       one client's, so the SAME id can sit in both -- and _ccFind always
       returns the Kasper copy, which may have been loaded much earlier. A write
       built from it replaces the whole row, so a stale password, handle, note
       or label would silently overwrite the fresher one the modal is showing.
       Found in review 2026-08-22. */
    function _ccFindIn(id, scope) {
        const first = scope === 'modal' ? _ccState.modal.credentials : _ccState.kasper.credentials;
        const second = scope === 'modal' ? _ccState.kasper.credentials : _ccState.modal.credentials;
        return (first || []).find(r => r.id === id) || (second || []).find(r => r.id === id) || null;
    }
    async function _ccEnsureIdentity() {
        return _syncviewRequireStaffIdentity('credentials');
    }

    async function _ccApi(action, payload, opts) {
        opts = opts || {};
        const ident = await _ccEnsureIdentity();
        const body = Object.assign({}, payload || {}, { action, actor: { name: ident.member.name, role: ident.role } });
        const send = () => fetch(CC_EDGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': ident.key },
            body: JSON.stringify(body),
        });
        // Listing and history are reads; every other action changes a credential.
        const isRead = action === 'list' || action === 'history';
        const resp = await (isRead ? send() : _writeUiTrackSave('credentials', ('credentials_' + action).slice(0, 40), {}, send, { requireOk: true }));
        let json = null;
        try { json = await resp.json(); } catch { json = null; }
        if (resp.status === 401) {
            const active = _syncviewStaffIdentityForHeaders();
            if (_syncviewStaffIdentitySignature(active) !== _syncviewStaffIdentitySignature(ident)) throw new Error('Staff sign-in changed.');
            _syncviewStaffIdentityClear();
            if (opts._retried) throw new Error((json && json.error) || 'Staff sign-in expired.');
            const replacement = await _syncviewOpenStaffIdentity({ reason: 'expired' });
            if (!replacement) throw new Error('Staff sign-in required.');
            return _ccApi(action, payload, Object.assign({}, opts, { _retried: true }));
        }
        const active = _syncviewStaffIdentityForHeaders();
        if (_syncviewStaffIdentitySignature(active) !== _syncviewStaffIdentitySignature(ident)) throw new Error('Staff sign-in changed.');
        if (resp.status === 403) throw new Error('Client credentials need an Admin or SMM account. Sign out first to use another authorized account.');
        if (!resp.ok || !json || !json.ok) throw new Error((json && json.error) || 'Credentials request failed');
        return json;
    }

    /* ── Standalone staff pages (/onboarding, /client-credentials) ──
       Onboarding and Client Credentials are used by SMMs (and Onboarding by
       creatives), not only admins, so they live at their own paths and in the
       staff menu, outside the admin-only Kasper tab. They reuse the Kasper
       renderers, which draw into #kasperContent, and keep each page's own
       capability check. */
    const SV_STAFF_PAGES = {
        'staff-onboarding': { capability: 'onboarding', title: 'Onboarding', render: () => _kasperRenderOnboarding() },
        'client-credentials': { capability: 'credentials', title: 'Client Credentials', render: () => _ccKasperRender() },
    };
    function _svStaffPageShell(page) {
        const def = SV_STAFF_PAGES[page];
        const head = page === 'client-credentials' ? '' : `<div class="kasper-head"><div class="kasper-title">${_calEsc(def.title)}</div></div>`;
        return `<div class="kasper-wrap sv-staff-page" data-sv-staff-page="${page}">${head}<div id="kasperContent"></div></div>`;
    }
    function _svStaffPageRender(page) {
        const def = SV_STAFF_PAGES[page];
        const el = document.getElementById('kasperContent');
        if (!def || !el) return;
        if (_syncviewStaffCan(def.capability)) { def.render(); return; }
        const pending = typeof _kasperStaffCheckPending === 'function' && _kasperStaffCheckPending();
        el.innerHTML = `<div class="kasper-empty">${pending ? 'Checking your sign-in…' : 'This page needs an SMM or Admin sign-in.'}</div>`;
        if (!pending) _syncviewOfferStaffSignIn(def.capability);
    }

    function _ccKasperRender() {
        const el = document.getElementById('kasperContent');
        if (!el) return;
        el.innerHTML = `<div class="cc-wrap">
            <div class="cc-topbar">
                <div><h2 class="cc-title">Client Credentials</h2><p class="cc-sub">The one place for client Instagram, TikTok, Facebook, LinkedIn, YouTube, and custom account logins. Password reveals and every edit are audited.</p></div>
                <div class="cc-actions">
                    <input class="cc-search" id="ccKasperSearch" placeholder="Search client, platform, handle, notes…" value="${_ccEscAttr(_ccState.kasper.search)}" oninput="_ccSetKasperSearch(this.value)">
                    <button class="cc-btn" type="button" onclick="_ccLoadKasper(false)">Refresh</button>
                    ${_syncviewStaffRoleValue(_syncviewStaffIdentityForHeaders()) === 'admin'
                        ? '<button class="cc-btn" type="button" onclick="_ccOpenOnboardingImport()">Import from onboarding</button>'
                        : ''}
                    <button class="cc-btn primary" type="button" onclick="_ccOpenEdit('', 'kasper')">Add credential</button>
                </div>
            </div>
            <div class="cc-body" id="ccKasperBody"></div>
        </div>`;
        _ccPaintKasper();
        _ccRevEnsureSubscribed('kasper');
        if (!_ccState.kasper.loaded && !_ccState.kasper.loading) _ccLoadKasper(false);
        // Returning to the tab with data already in hand: refresh in the
        // background so any peer add/edit/archive that landed while Kasper was on
        // another subtab (when the rev ping was ignored) surfaces without a
        // manual Refresh. No loader flash — the current rows stay up until the
        // fetch lands.
        else if (_ccState.kasper.loaded && !_ccState.kasper.loading) _ccLoadKasper(true);
    }

    function _ccSetKasperSearch(v) { _ccState.kasper.search = v || ''; _ccPaintKasper(); }

    async function _ccLoadKasper(background) {
        if (_ccState.kasper.loading) return;
        _ccState.kasper.loading = true; _ccState.kasper.error = null;
        if (!background) _ccPaintKasper();
        try {
            const json = await _ccApi('list', {});
            _ccState.kasper.credentials = Array.isArray(json.credentials) ? json.credentials : [];
            _ccState.kasper.loaded = true;
        } catch (e) {
            _ccState.kasper.error = e && e.message ? e.message : String(e);
        } finally {
            _ccState.kasper.loading = false;
            _ccPaintKasper();
        }
    }

    function _ccFilteredKasperRows() {
        const q = String(_ccState.kasper.search || '').trim().toLowerCase();
        let rows = (_ccState.kasper.credentials || []).slice();
        if (q) rows = rows.filter(r => [r.client_name, r.platform, r.label, r.handle, r.notes, r.status].some(v => String(v || '').toLowerCase().includes(q)));
        rows.sort((a, b) => {
            const au = _ccIsUnmatched(a) ? 0 : 1, bu = _ccIsUnmatched(b) ? 0 : 1;
            if (au !== bu) return au - bu;
            return String(a.client_name || '').localeCompare(String(b.client_name || '')) || String(a.platform || '').localeCompare(String(b.platform || ''));
        });
        return rows;
    }

    function _ccPaintKasper() {
        const body = document.getElementById('ccKasperBody');
        if (!body) return;
        if (_ccState.kasper.loading && !_ccState.kasper.loaded) { body.innerHTML = _calLoaderHtml('Loading credentials…'); return; }
        if (_ccState.kasper.error) { body.innerHTML = `<div class="cc-empty"><strong>Could not load credentials.</strong><br>${_ccEsc(_ccState.kasper.error)}</div>`; return; }
        const rows = _ccFilteredKasperRows();
        if (!rows.length) { body.innerHTML = `<div class="cc-empty">No credentials found yet.${_ccState.kasper.search ? '<br>Try a different search.' : '<br>Use Add credential to start.'}</div>`; return; }
        const grouped = new Map();
        rows.forEach(r => {
            const key = String(r.client_slug || 'unknown');
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(r);
        });
        body.innerHTML = `<div class="cc-grid">${Array.from(grouped.entries()).map(([slug, list]) => _ccClientCardHtml(slug, list, 'kasper')).join('')}</div>`;
    }

    function _ccClientCardHtml(slug, rows, scope) {
        const first = rows[0] || {};
        const unmatched = rows.some(_ccIsTrulyUnmatched);
        const needsReview = !unmatched && rows.some(r => r.status === 'needs_review');
        const clientName = first.client_name || _ccClientNameForSlug(slug);
        const addClientArg = _jsAttrArg(slug);
        const slugArg = _jsAttrArg(slug);
        // In the Kasper list every client is collapsed by default; the header
        // acts as a disclosure control (the client name, credential count and
        // any "needs review" chip stay visible while collapsed). The modal
        // (single client) is never collapsible.
        const collapsible = scope === 'kasper';
        const open = !collapsible || _ccExpanded.has(slug);
        const titleHtml = `<div><div class="cc-client">${unmatched ? 'Unmatched: ' : ''}${_ccEsc(clientName)}</div><div class="cc-client-meta"><span>${rows.length} credential${rows.length === 1 ? '' : 's'}</span>${unmatched ? '<span class="cc-chip warn">no matching client — reassign</span>' : (needsReview ? '<span class="cc-chip">imported — glance &amp; confirm</span>' : '')}</div></div>`;
        const headMain = collapsible
            ? `<button class="cc-card-toggle" type="button" aria-expanded="${open ? 'true' : 'false'}" aria-label="Expand or collapse ${_ccEscAttr(clientName)}" onclick="_ccToggleCard(${slugArg}, this)">${CC_ICON_CHEV}${titleHtml}</button>`
            : titleHtml;
        return `<div class="cc-card${unmatched ? ' needs-review' : ''}${collapsible ? ' cc-collapsible' : ''}${open ? ' cc-open' : ''}">
            <div class="cc-card-head">
                ${headMain}
                <div class="cc-actions">
                    ${scope === 'kasper' ? `<button class="cc-btn" type="button" onclick="_ccOpenHistory('', ${addClientArg})">History</button><button class="cc-btn" type="button" onclick="_ccOpenEdit('', 'kasper', ${addClientArg})">Add</button>` : `<button class="cc-btn" type="button" onclick="_ccOpenEdit('', 'modal')">Add</button>`}
                </div>
            </div>
            <div class="cc-rows">${rows.map(r => _ccRowHtml(r, scope)).join('')}</div>
        </div>`;
    }
    function _ccToggleCard(slug, btn) {
        const card = btn && btn.closest ? btn.closest('.cc-card') : null;
        if (!card) return;
        const willOpen = !card.classList.contains('cc-open');
        if (willOpen) _ccExpanded.add(slug); else _ccExpanded.delete(slug);
        card.classList.toggle('cc-open', willOpen);
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }

    function _ccRowHtml(r, scope) {
        const idArg = _jsAttrArg(r.id || '');
        const scopeArg = _jsAttrArg(scope || 'kasper');
        const hasPw = String(r.password || '').length > 0;
        const revealed = _ccRevealed.has(r.id);
        const pass = hasPw ? (revealed ? _ccEsc(r.password) : CC_MASK) : 'empty';
        const statusChip = r.status === 'needs_review' ? '<span class="cc-chip warn">needs review</span>' : (r.status === 'archived' ? '<span class="cc-chip">archived</span>' : '');
        // The inline "Updated {time} by {person}" line was removed for every role —
        // clicking History gives the full, audited change log. Only the notes (and
        // the reassign control for unmatched rows) remain under the platform.
        const reassign = (scope === 'kasper' && _ccIsUnmatched(r)) ? _ccReassignHtml(r) : '';
        const metaHtml = r.notes ? _ccEsc(r.notes) : '';
        const footHtml = (metaHtml || reassign) ? `<div class="cc-updated">${metaHtml}${reassign}</div>` : '';
        return `<div class="cc-row" data-cc-id="${_ccEscAttr(r.id)}">
            <div class="cc-platform"><strong>${_ccEsc(_ccPlatformLabel(r.platform))}</strong>${statusChip ? `<span>${statusChip}</span>` : ''}</div>
            <div class="cc-handle"><code>${r.handle ? _ccEsc(r.handle) : 'no handle'}</code>${r.handle ? `<button class="cc-mini" type="button" title="Copy handle" aria-label="Copy handle" onclick="_ccCopyText(${_jsAttrArg(r.handle)}, 'Handle copied')">${CC_ICON_COPY}</button>` : ''}</div>
            <div class="cc-secret"><code>${pass}</code>${hasPw ? `<button class="cc-mini${revealed ? ' is-active' : ''}" type="button" title="${revealed ? 'Hide password' : 'Reveal password'}" aria-label="${revealed ? 'Hide password' : 'Reveal password'}" onclick="_ccReveal(${idArg}, ${scopeArg})">${revealed ? CC_ICON_EYE_OFF : CC_ICON_EYE}</button><button class="cc-mini" type="button" title="Copy password" aria-label="Copy password" onclick="_ccCopyPassword(${idArg}, ${scopeArg})">${CC_ICON_COPY}</button>` : ''}</div>
            <div class="cc-row-actions">${r.status === 'needs_review' ? `<button class="cc-mini" type="button" title="Mark reviewed" aria-label="Mark reviewed" onclick="_ccMarkReviewed(${idArg}, ${scopeArg})">${CC_ICON_CHECK}</button>` : ''}<button class="cc-mini" type="button" title="History" aria-label="History" onclick="_ccOpenHistory(${idArg})">${CC_ICON_HISTORY}</button><button class="cc-mini" type="button" title="Edit" aria-label="Edit" onclick="_ccOpenEdit(${idArg}, ${scopeArg})">${CC_ICON_EDIT}</button><button class="cc-mini" type="button" title="Archive" aria-label="Archive" onclick="_ccArchive(${idArg}, ${scopeArg})">${CC_ICON_ARCHIVE}</button></div>
            ${footHtml}
        </div>`;
    }

    function _ccReassignHtml(r) {
        const selId = 'ccReassign_' + String(r.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        return `<div style="margin-top:8px;display:flex;gap:7px;align-items:center;flex-wrap:wrap;"><div style="width:220px;">${_ccSelectHtml(selId, _ccClientSelectItems(''), '', 'Assign client')}</div><button class="cc-btn" type="button" onclick="_ccReassign(${_jsAttrArg(r.id)}, ${_jsAttrArg(selId)})">Assign to client</button></div>`;
    }

    async function _ccCopyText(text, msg) {
        const s = String(text || '');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(s); showToast(msg || 'Copied'); return; }
        } catch (e) { /* fall through to the no-popup fallback */ }
        // Fallback without a native prompt: a hidden textarea + execCommand copy.
        try {
            const ta = document.createElement('textarea');
            ta.value = s; ta.setAttribute('readonly', '');
            ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0'; ta.style.pointerEvents = 'none';
            document.body.appendChild(ta); ta.select();
            try { ta.setSelectionRange(0, s.length); } catch (e) {}
            const ok = document.execCommand && document.execCommand('copy');
            document.body.removeChild(ta);
            showToast(ok ? (msg || 'Copied') : 'Press Ctrl/Cmd+C to copy');
        } catch (e) { showToast('Could not copy'); }
    }

    function _ccReveal(id, scope) {
        const row = _ccFind(id); if (!row || !row.password) return;
        // Reveal must be INSTANT. The password is already in hand (it came down
        // with the list), so flip the mask + repaint synchronously first; the
        // ~2s stall was the log_reveal round-trip being awaited before the
        // repaint. Only the SHOW direction is audited, fire-and-forget — a
        // failed audit call never blocks or reverts the reveal the user asked
        // for (and hiding needs no server call at all).
        const revealing = !_ccRevealed.has(id);
        if (revealing) _ccRevealed.add(id); else _ccRevealed.delete(id);
        if (scope === 'modal') _ccPaintModal(); else _ccPaintKasper();
        if (revealing) { try { _ccApi('log_reveal', { credential_id: id }).catch(() => {}); } catch (e) {} }
    }

    async function _ccCopyPassword(id, scope) {
        const row = _ccFind(id); if (!row || !row.password) return;
        if (!_ccRevealed.has(id)) await _ccReveal(id, scope);
        await _ccCopyText(row.password, 'Password copied');
    }

    function _ccKnownClientOptions(selectedSlug) {
        return _ccKnownClients().map(n => {
            const slug = wlNormalizeClient(n);
            return `<option value="${_ccEscAttr(slug + '|' + n)}"${slug === selectedSlug ? ' selected' : ''}>${_ccEsc(n)}</option>`;
        }).join('');
    }

    function _ccOpenEdit(id, scope, clientSlug) {
        scope = scope || 'kasper';
        const row = id ? _ccFind(id) : null;
        const fixedClient = scope === 'modal' ? calClientSlug(_ccState.modal.client) : (clientSlug || (row && row.client_slug) || '');
        const fixedName = scope === 'modal' ? _ccState.modal.client : ((row && row.client_name) || _ccClientNameForSlug(fixedClient));
        const platformValue = String((row && row.platform) || 'instagram').trim().toLowerCase();
        const platformItems = (CC_PLATFORM_OPTIONS.includes(platformValue) ? CC_PLATFORM_OPTIONS : [platformValue].concat(CC_PLATFORM_OPTIONS)).filter(Boolean);
        const ov = document.createElement('div');
        ov.className = 'cal-import-overlay open cc-sensitive-overlay';
        if (typeof ov.setAttribute === 'function') ov.setAttribute('data-backdrop-dismiss', '');
        ov.innerHTML = `<div class="cal-import-modal cc-modal-wide" role="dialog" aria-modal="true">
            <div class="cal-import-head"><button class="cal-import-x" type="button" id="ccEditClose">×</button><h3>${row ? 'Edit credential' : 'Add credential'}</h3><p>${scope === 'modal' ? _ccEsc(_ccState.modal.client) : 'Kasper credentials store'}</p></div>
            <div class="cal-import-body">
                <div class="cc-form-grid">
                    <div class="cc-field full" ${fixedClient ? 'style="display:none;"' : ''}><label>Client</label>${_ccSelectHtml('ccEditClient', _ccClientSelectItems(fixedClient), '', 'Choose client')}</div>
                    <div class="cc-field"><label>Platform</label>${_ccSelectHtml('ccEditPlatform', _ccSelectItemsFromValues(platformItems), platformValue, 'Choose platform')}</div>
                    <div class="cc-field"><label>Handle</label><input id="ccEditHandle" value="${_ccEscAttr((row && row.handle) || '')}" placeholder="@client"></div>
                    <div class="cc-field full"><label>Password</label><div class="cc-password-wrap"><input id="ccEditPassword" type="password" value="${_ccEscAttr((row && row.password) || '')}" placeholder="Password"><button class="cc-pass-toggle" type="button" title="Show password" aria-label="Show password" aria-pressed="false" onclick="_ccTogglePasswordField('ccEditPassword', this)">${CC_ICON_EYE}</button></div></div>
                    <div class="cc-field full"><label>Notes</label><textarea id="ccEditNotes" placeholder="2FA, backup codes, login quirks…">${_ccEsc((row && row.notes) || '')}</textarea></div>
                </div>
            </div>
            <div class="cal-import-foot"><button class="cal-import-btn-ghost" type="button" id="ccEditCancel">Cancel</button><button class="cal-import-btn-primary" type="button" id="ccEditSave">Save</button></div>
        </div>`;
        document.body.appendChild(ov);
        const close = () => { _ccCloseSelect(); ov.remove(); };
        ov.querySelector('#ccEditClose').onclick = close;
        ov.querySelector('#ccEditCancel').onclick = close;
        ov.onclick = e => { if (e.target === ov && ov._backdropPressBegan) close(); };
        ov.querySelector('#ccEditSave').onclick = async () => {
            const btn = ov.querySelector('#ccEditSave'); btn.disabled = true;
            try {
                let slug = fixedClient, name = fixedName;
                if (!slug) {
                    const parts = String(ov.querySelector('#ccEditClient').value || '').split('|');
                    slug = parts[0]; name = parts.slice(1).join('|');
                }
                const credential = {
                    id: row && row.id,
                    client_slug: slug,
                    client_name: name,
                    platform: ov.querySelector('#ccEditPlatform').value.trim(),
                    // The dialog has no label field, and sending '' here WIPED the
                    // label of every row anyone edited -- which is why the manual
                    // rows all carry an empty label while the imported ones do not,
                    // and why the 2026-08-21 protection lookup could not key on it.
                    // Carry the stored label through untouched.
                    label: (row && row.label) || '',
                    handle: ov.querySelector('#ccEditHandle').value.trim(),
                    password: ov.querySelector('#ccEditPassword').value,
                    status: (row && row.status) || 'active',
                    notes: ov.querySelector('#ccEditNotes').value.trim(),
                    source: row && row.source ? row.source : 'manual',
                };
                // Same rule as the label above, for the same reason: the
                // gateway replaces the row, so a field this dialog does not
                // show still has to be carried or it is deleted. raw_import is
                // the import provenance behind every needs_review row.
                if (row && typeof row.raw_import !== 'undefined') credential.raw_import = row.raw_import;
                await _ccApi('upsert', { credential });
                _ccLastLocalWriteAt = Date.now();
                close(); showToast('Credential saved');
                if (scope === 'modal') _ccLoadModal(true); else _ccLoadKasper(true);
            } catch (e) { showToast((e && e.message) || 'Could not save'); btn.disabled = false; }
        };
    }

    function _ccArchive(id, scope) {
        scope = scope || 'kasper';
        if (!id) return;
        // Styled in-app confirm (showConfirm, z-index 9999 so it layers above the
        // SMM credentials modal) instead of the native browser confirm() dialog.
        showConfirm('Archive credential', 'Archive this credential? It will disappear from the active list but stay in audit history.', async () => {
            try {
                await _ccApi('delete', { credential_id: id });
                _ccLastLocalWriteAt = Date.now();
                showToast('Credential archived');
                if (scope === 'modal') _ccLoadModal(true); else _ccLoadKasper(true);
            } catch (e) { showToast((e && e.message) || 'Could not archive'); }
        }, 'Archive');
    }

    /* MARK REVIEWED (owner request 2026-08-22).
       Every imported credential lands `needs_review` on purpose -- a wrong guess
       about a credential is worse than no guess -- but nothing could ever clear
       that state: the edit dialog re-sends whatever status the row already had,
       so a reviewed row stayed flagged for ever and the queue only grew. 47 rows
       were stuck this way. This is the missing half of that deliberate design.

       It rides the existing `upsert`, which the gateway treats as a FULL row
       replace, not a patch -- so the row's own password has to be sent back
       verbatim. If a future list ever stops returning it, sending the absent
       value would silently NULL the secret, so refuse instead of guessing: an
       absent password property is a bug, an empty one is a real empty. */
    async function _ccMarkReviewed(id, scope) {
        scope = scope || 'kasper';
        const row = _ccFindIn(id, scope);
        if (!row || row.status !== 'needs_review') return;
        /* The gateway REPLACES the whole row: materializeCredential turns an
           omitted field into null and includes it in the update. So a partial
           row here is not a partial write, it is a deletion. Every field the
           replacement carries must therefore be present on the row we read --
           including raw_import, which is the imported provenance and its audit
           diff, and which every one of the 47 needs_review rows carries. This
           button exists to be clicked on exactly those rows.
           Same shape as the importer defect fixed the same day: absent meant
           NULL, not "no opinion". */
        if (typeof row.password === 'undefined' || typeof row.raw_import === 'undefined') {
            showToast('Cannot confirm this row from here -- reload and try again');
            return;
        }
        try {
            await _ccApi('upsert', {
                credential: {
                    id: row.id,
                    client_slug: row.client_slug,
                    client_name: row.client_name,
                    platform: row.platform,
                    label: row.label || '',
                    handle: row.handle || '',
                    password: row.password || '',
                    status: 'active',
                    notes: row.notes || '',
                    source: row.source || 'manual',
                    raw_import: row.raw_import === null ? null : row.raw_import,
                },
            });
            _ccLastLocalWriteAt = Date.now();
            showToast('Marked reviewed');
            if (scope === 'modal') _ccLoadModal(true); else _ccLoadKasper(true);
        } catch (e) { showToast((e && e.message) || 'Could not update'); }
    }

    async function _ccReassign(id, selectId) {
        const el = document.getElementById(selectId); if (!el) return;
        const parts = String(el.value || '').split('|');
        const client_slug = parts[0], client_name = parts.slice(1).join('|');
        try {
            await _ccApi('reassign', { credential_id: id, client_slug, client_name });
            _ccLastLocalWriteAt = Date.now();
            showToast('Assigned to ' + client_name);
            _ccLoadKasper(true);
        } catch (e) { showToast((e && e.message) || 'Could not reassign'); }
    }

    function _ccOpenHistory(id, clientSlug) {
        const ov = document.createElement('div');
        ov.className = 'cal-import-overlay open cc-sensitive-overlay';
        if (typeof ov.setAttribute === 'function') ov.setAttribute('data-backdrop-dismiss', '');
        ov.innerHTML = `<div class="cal-import-modal cc-modal-wide" role="dialog" aria-modal="true"><div class="cal-import-head"><button class="cal-import-x" type="button" id="ccHistClose">×</button><h3>Credential history</h3><p>Every change, reveal, import, and reassignment.</p></div><div class="cal-import-body" id="ccHistBody">${_calLoaderHtml('Loading history…')}</div></div>`;
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.querySelector('#ccHistClose').onclick = close;
        ov.onclick = e => { if (e.target === ov && ov._backdropPressBegan) close(); };
        _ccApi('history', id ? { credential_id: id } : { client_slug: clientSlug })
            .then(json => { const body = ov.querySelector('#ccHistBody'); const events = json.events || []; body.innerHTML = events.length ? `<div class="cc-history-list">${events.map(_ccEventHtml).join('')}</div>` : '<div class="cc-empty">No history yet.</div>'; })
            .catch(e => { const body = ov.querySelector('#ccHistBody'); body.innerHTML = `<div class="cc-empty">${_ccEsc((e && e.message) || 'Could not load history')}</div>`; });
    }

    function _ccEventHtml(ev) {
        const field = ev.field ? `<span class="cc-chip">${_ccEsc(ev.field)}</span>` : '';
        const diff = ev.field ? `<div class="cc-diff"><code>${_ccEsc(ev.old_value || 'empty')}</code><span>→</span><code>${_ccEsc(ev.new_value || 'empty')}</code></div>` : '';
        const where = [ev.ip, ev.country].filter(Boolean).join(' · ');
        return `<div class="cc-event"><div class="cc-event-head"><span>${_ccEsc(ev.action)} ${field}</span><span>${_ccPrettyDate(ev.event_at)}</span></div><div class="cc-event-meta">${_ccEsc(ev.actor || 'unknown')} · ${_ccEsc(ev.actor_role || 'staff')}${where ? ' · ' + _ccEsc(where) : ''}</div>${diff}</div>`;
    }

    /* Import the credentials clients already gave us at onboarding.

       Clients type their logins into the onboarding form and that is where the
       answers have been sitting: 19 submissions, 90 answers, while this store
       held 12 rows across 5 clients and 32 active clients had nothing at all.
       The gateway could already do this -- an onboarding_import action existed,
       fully written, with no caller. This is the caller.

       REVIEW IS THE POINT, not a formality. The values are free text a client
       typed, so a third of them cannot be parsed into a handle and a password,
       and some are not credentials at all ("Working on getting this for you!").
       Every row is previewed, every row is deselectable, nothing is written
       until Import is pressed, and everything written lands needs_review.

       Passwords are NOT rendered here. A reviewer is checking that the row is
       the right client, platform and account -- not reading the secret -- and
       this screen would otherwise put every client password on one screen at
       once. The store has an audited per-credential reveal for that. */
    const CC_ONBOARDING_FLAG_TEXT = {
        no_answer: 'client left this blank',
        access_note: 'note, not a login',
        backup_code: 'backup code',
        needs_review: 'could not read a password',
        unknown_client: 'client not recognised',
        existing_manual: 'already saved by hand — kept',
    };
    /* Describe an unreadable answer by SHAPE so a reviewer can act on it
       without the text being printed. Each branch maps to a different remedy:
       a missing separator is a human split away from usable, a sentence needs
       reading, a promise needs the CLIENT chasing. */
    function _ccObUnreadReason(text) {
        const value = String(text || '').trim();
        if (!value) return 'the client left this empty';
        const words = value.split(/\s+/).length;
        if (/^\+?[\d()\s.-]{7,}$/.test(value)) return 'looks like a phone number with no password beside it';
        if (!value.includes('/') && !/:|\bpassword\b|\bpass\b|\bpw\b/i.test(value) && words <= 3) {
            return 'one value with no separator -- cannot tell the account from the password';
        }
        if (words > 12) return 'a long sentence -- the details may be in there, but not in a shape we can split';
        if (words > 3) return 'written as a sentence rather than account and password';
        return 'no recognisable account-and-password pair';
    }
    function _ccObReveal(btn) {
        if (!btn) return;
        const raw = btn.getAttribute('data-cc-ob-raw') || '';
        const holder = document.createElement('span');
        holder.className = 'cc-ob-revealed';
        holder.textContent = raw;
        btn.replaceWith(holder);
    }
    function _ccOnboardingRowUsable(row) {
        const flags = (row && row.flags) || [];
        if (flags.includes('no_answer') || flags.includes('access_note')) return false;
        if (flags.includes('unknown_client')) return false;
        /* A credential someone typed by hand is protected server-side and will
           not be overwritten (owner ruling 2026-08-20 -- the manual value may
           be NEWER than the onboarding answer). Not pre-ticking it as well
           keeps the screen honest: a ticked row that silently does nothing
           reads as a bug. It stays selectable so the count is never a lie. */
        if (flags.includes('existing_manual')) return false;
        return !!(row && (row.password || row.handle));
    }
    async function _ccOpenOnboardingImport() {
        const ov = document.createElement('div');
        ov.className = 'cal-import-overlay open cc-sensitive-overlay';
        if (typeof ov.setAttribute === 'function') ov.setAttribute('data-backdrop-dismiss', '');
        ov.innerHTML = `<div class="cal-import-modal cc-modal-wide" role="dialog" aria-modal="true">
            <div class="cal-import-head"><button class="cal-import-x" type="button" id="ccObClose">&times;</button><h3>Import from onboarding</h3><p>Credentials clients entered on the onboarding form. Nothing is saved until you press Import, and everything imported is marked <strong>needs review</strong>.</p></div>
            <div class="cal-import-body"><div class="cal-import-progress" id="ccObBody">Reading onboarding submissions...</div></div>
            <div class="cal-import-foot"><span class="cc-ob-summary" id="ccObSummary"></span><button class="cal-import-btn-ghost" type="button" id="ccObAllBtn" disabled onclick="_ccObAll(true)">Select all</button><button class="cal-import-btn-ghost" type="button" id="ccObNoneBtn" disabled onclick="_ccObAll(false)">Select none</button><button class="cal-import-btn-primary" type="button" id="ccObImportBtn" disabled>Import selected</button></div>
        </div>`;
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.querySelector('#ccObClose').onclick = close;
        ov.onclick = e => { if (e.target === ov && ov._backdropPressBegan) close(); };
        const body = ov.querySelector('#ccObBody');
        const importBtn = ov.querySelector('#ccObImportBtn');
        const summary = ov.querySelector('#ccObSummary');

        let groups = [];
        try {
            const full = await (await svArea('templates')).obvFetchFull();
            if (full && full.error) throw new Error(full.error);
            /* onboarding-full returns THREE funnel shapes and they do not agree.
               A legacy row carries a `credentials` array; a standard or AI row
               carries flat per-platform keys on `answers` and no credentials
               array at all. Filtering on `credentials` alone silently dropped
               every current-funnel submission -- so the screen could only ever
               have imported the legacy backlog, never a new client.

               Identity differs too: none of the three sends `client_name` or
               `client_slug`. They send `slug`, `first_name` and `last_name`.
               Reading the wrong fields left every row with an empty name, which
               flagged the whole import `unknown_client` and would have filed
               anything manually selected under "(unnamed)". The n8n workflow
               that posts on submit already composes the name the same way; this
               matches it rather than inventing a second convention. */
            const subs = (full && Array.isArray(full.submissions) ? full.submissions : [])
                .map(sub => {
                    const answers = (sub && sub.answers && typeof sub.answers === 'object') ? sub.answers : {};
                    return {
                        slug: String((sub && sub.slug) || '').trim(),
                        name: [sub && sub.first_name, sub && sub.last_name].filter(Boolean).join(' ').trim(),
                        credentials: Array.isArray(sub && sub.credentials) ? sub.credentials : null,
                        answers,
                    };
                })
                .filter(sub => (sub.credentials && sub.credentials.length)
                    || Object.keys(sub.answers).length);
            if (!subs.length) { body.innerHTML = '<div class="cc-empty">No onboarding submission carries credentials.</div>'; return; }
            /* Preview each submission through the SAME gateway action that will
               write it, so what is reviewed is what lands -- not a second
               parser in the browser that could drift from the real one. */
            for (const sub of subs) {
                let preview = [];
                try {
                    const res = await _ccApi('onboarding_import', {
                        client_name: sub.name, client_slug: sub.slug,
                        credentials: sub.credentials || undefined, answers: sub.answers,
                        known_clients: _ccKnownClients(), dry_run: true,
                    });
                    preview = (res && res.preview) || [];
                } catch (e) { preview = []; }
                if (preview.length) groups.push({ name: sub.name || sub.slug || '(unnamed)', slug: sub.slug, rows: preview });
            }
        } catch (e) {
            body.innerHTML = '<div class="cc-empty">' + _ccEsc((e && e.message) || 'Could not read onboarding.') + '</div>';
            return;
        }
        if (!groups.length) { body.innerHTML = '<div class="cc-empty">Nothing importable found.</div>'; return; }

        const chosen = new Set();
        groups.forEach((g, gi) => g.rows.forEach((r, ri) => { if (_ccOnboardingRowUsable(r)) chosen.add(gi + ':' + ri); }));
        const key = (gi, ri) => gi + ':' + ri;
        window._ccObToggle = (gi, ri, on) => {
            if (on) chosen.add(key(gi, ri)); else chosen.delete(key(gi, ri));
            paint(true);
        };
        /* Bulk toggles. The default selection is already the sensible one, but
           with dozens of clients on screen a reviewer who disagrees with it
           should not have to click every row to say so. Selecting ALL is
           allowed to include rows the default skipped -- a human overruling
           the heuristic is exactly what this screen is for -- EXCEPT rows
           already saved by hand, which stay unselectable because the server
           will refuse them anyway and a tick that does nothing is a lie. */
        const selectable = (gi, ri) => !(groups[gi].rows[ri].flags || []).includes('existing_manual');
        window._ccObGroup = (gi) => {
            const rows = groups[gi].rows;
            const all = rows.every((r, ri) => chosen.has(key(gi, ri)) || !selectable(gi, ri));
            rows.forEach((r, ri) => {
                if (!selectable(gi, ri)) return;
                if (all) chosen.delete(key(gi, ri)); else chosen.add(key(gi, ri));
            });
            paint(true);
        };
        window._ccObAll = (on) => {
            groups.forEach((g, gi) => g.rows.forEach((r, ri) => {
                if (!selectable(gi, ri)) return;
                if (on) chosen.add(key(gi, ri)); else chosen.delete(key(gi, ri));
            }));
            paint(true);
        };
        function paint(keepScroll) {
            const top = keepScroll ? body.scrollTop : 0;
            body.innerHTML = groups.map((g, gi) => `<div class="cc-ob-group"><div class="cc-ob-client">${_ccEsc(g.name)}<button class="cc-ob-groupsel" type="button" onclick="event.preventDefault();_ccObGroup(${gi})">${g.rows.every((r, ri) => chosen.has(key(gi, ri))) ? 'none' : 'all'}</button></div>${g.rows.map((r, ri) => {
                const flags = (r.flags || []).map(f => `<span class="cc-chip${_ccOnboardingRowUsable(r) ? '' : ' warn'}">${_ccEsc(CC_ONBOARDING_FLAG_TEXT[f] || f)}</span>`).join('');
                const secret = r.password ? '<span class="cc-ob-has">secret captured</span>' : '<span class="cc-ob-none">no secret</span>';
                /* Say WHY we could not read it -- without printing it.
                   "Could not read a password" with no explanation is an
                   accusation with no evidence: the reviewer cannot tell a
                   client who wrote prose around a real password from one who
                   said they would send it later, and those need opposite
                   actions. But printing the answer was the wrong way to supply
                   that evidence, and review of this PR was right to stop it: a
                   parse fails PRECISELY BECAUSE the parser could not recognise
                   the secret, so an unread answer is MORE likely to contain a
                   loose password, not less. Measured on the real data: 2 of the
                   18 unreadable answers carry a password- or code-shaped token,
                   and this screen would have printed them in bulk, right under
                   its own promise not to show passwords.

                   So the default is a SHAPE, never the text. The one-row
                   reveal below is deliberate, one at a time, and never part of
                   a bulk scan. */
                const showRaw = !r.password && (r.raw || r.notes);
                const rawText = String(r.raw || r.notes || '');
                const rawLine = showRaw
                    ? `<div class="cc-ob-raw"><span>why:</span> ${_ccEsc(_ccObUnreadReason(rawText))}<button class="cc-ob-reveal" type="button" onclick="event.preventDefault();event.stopPropagation();_ccObReveal(this)" data-cc-ob-raw="${_ccEscAttr(rawText.slice(0, 300))}">show answer</button></div>`
                    : '';
                const locked = (r.flags || []).includes('existing_manual');
                return `<label class="cc-ob-row${showRaw ? ' has-raw' : ''}${locked ? ' is-locked' : ''}"><input type="checkbox" ${chosen.has(key(gi, ri)) ? 'checked' : ''}${locked ? ' disabled' : ''} onchange="_ccObToggle(${gi},${ri},this.checked)">
                    <span class="cc-ob-plat">${_ccEsc(r.platform || 'account')}</span>
                    <span class="cc-ob-label">${_ccEsc(r.label || '')}</span>
                    <span class="cc-ob-handle">${_ccEsc(r.handle || '--')}</span>
                    ${secret}<span class="cc-flags">${flags}</span>${rawLine}</label>`;
            }).join('')}</div>`).join('');
            body.scrollTop = top;
            const n = chosen.size;
            summary.textContent = n + (n === 1 ? ' credential selected' : ' credentials selected');
            importBtn.disabled = !n;
            /* Enabled only here, once the groups exist and the handlers are
               assigned. They ship disabled in the shell markup: previews load
               sequentially, and _ccObAll is not defined until that finishes --
               so an early click threw a ReferenceError, and any path that
               returned early (a load error, no submissions, nothing
               importable) left them enabled and permanently dead. */
            const allBtn = ov.querySelector('#ccObAllBtn');
            const noneBtn = ov.querySelector('#ccObNoneBtn');
            if (allBtn) allBtn.disabled = false;
            if (noneBtn) noneBtn.disabled = false;
        }
        paint(false);

        importBtn.onclick = async () => {
            importBtn.disabled = true; importBtn.textContent = 'Importing...';
            let imported = 0, failed = 0, keptManual = 0;
            for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                /* Send only the SELECTED rows, re-expressed as the labelled
                   {label, value} pairs the preview derived. Re-sending the
                   PREVIEW's own output rather than the raw submission is what
                   keeps this correct across all three funnel shapes: whatever
                   the gateway understood on the way in, it re-parses
                   identically on the way out, so what was reviewed is exactly
                   what lands. The selection is enforced by narrowing the
                   payload, never by asking the server to filter. */
                const picked = g.rows
                    .filter((r, ri) => chosen.has(key(gi, ri)))
                    .map(r => ({ label: r.label || '', value: r.raw || r.notes || '' }))
                    .filter(entry => entry.label || entry.value);
                if (!picked.length) continue;
                try {
                    const res = await _ccApi('onboarding_import', {
                        client_name: g.name, client_slug: g.slug || '', credentials: picked,
                        known_clients: _ccKnownClients(), dry_run: false,
                    });
                    imported += (res && res.imported) || 0;
                    keptManual += (res && res.skipped_existing_manual) || 0;
                } catch (e) { failed++; }
            }
            _ccLastLocalWriteAt = Date.now();
            close();
            const keptText = keptManual ? `, kept ${keptManual} existing manual` : '';
            showToast(failed
                ? `Imported ${imported}${keptText}; ${failed} client${failed === 1 ? '' : 's'} failed`
                : `Imported ${imported} credential${imported === 1 ? '' : 's'} for review${keptText}`);
            _ccLoadKasper(true);
        };
    }

    function _ccOpenBulkImport() {
        const ov = document.createElement('div');
        ov.className = 'cal-import-overlay open cc-sensitive-overlay';
        if (typeof ov.setAttribute === 'function') ov.setAttribute('data-backdrop-dismiss', '');
        ov.innerHTML = `<div class="cal-import-modal cc-modal-wide" role="dialog" aria-modal="true">
            <div class="cal-import-head"><button class="cal-import-x" type="button" id="ccBulkClose">×</button><h3>Bulk import credentials</h3><p>Paste one account per line: Client name | platform | handle | password | notes</p></div>
            <div class="cal-import-body"><div class="cc-field full"><label>Paste credentials</label><textarea id="ccBulkText" style="min-height:170px;" placeholder="Jane Doe | instagram | @janedoe | password123 | 2FA backup…"></textarea></div><div id="ccBulkPreview"></div></div>
            <div class="cal-import-foot"><button class="cal-import-btn-ghost" type="button" id="ccBulkPreviewBtn">Preview</button><button class="cal-import-btn-primary" type="button" id="ccBulkImportBtn" disabled>Import</button></div>
        </div>`;
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.querySelector('#ccBulkClose').onclick = close;
        ov.onclick = e => { if (e.target === ov && ov._backdropPressBegan) close(); };
        let preview = null;
        const renderPreview = (rows) => {
            const box = ov.querySelector('#ccBulkPreview');
            preview = rows || [];
            ov.querySelector('#ccBulkImportBtn').disabled = !preview.length;
            box.innerHTML = preview.length ? `<div class="cc-bulk-preview"><div class="cc-bulk-row"><div>#</div><div>Client</div><div>Platform</div><div>Handle</div><div>Flags</div></div>${preview.map(r => `<div class="cc-bulk-row"><div>${r.line}</div><div>${_ccEsc(r.client_name)}</div><div>${_ccEsc(r.platform)}</div><div>${_ccEsc(r.handle || 'empty')}</div><div class="cc-flags">${(r.flags || []).length ? r.flags.map(f => `<span class="cc-chip${f.includes('unknown') || f.includes('missing') ? ' warn' : ''}">${_ccEsc(f)}</span>`).join('') : '<span class="cc-chip">ok</span>'}</div></div>`).join('')}</div>` : '<div class="cc-empty" style="margin-top:12px;">No valid lines found.</div>';
        };
        ov.querySelector('#ccBulkPreviewBtn').onclick = async () => {
            try {
                const json = await _ccApi('bulk_import', { text: ov.querySelector('#ccBulkText').value, dry_run: true, known_clients: _ccKnownClients() });
                renderPreview(json.preview || []);
            } catch (e) { showToast((e && e.message) || 'Preview failed'); }
        };
        ov.querySelector('#ccBulkImportBtn').onclick = async () => {
            if (!preview || !preview.length) return;
            const btn = ov.querySelector('#ccBulkImportBtn'); btn.disabled = true;
            try {
                const json = await _ccApi('bulk_import', { text: ov.querySelector('#ccBulkText').value, dry_run: false, known_clients: _ccKnownClients() });
                _ccLastLocalWriteAt = Date.now();
                close(); showToast(`Imported ${json.imported || 0} credentials`); _ccLoadKasper(true);
            } catch (e) { showToast((e && e.message) || 'Import failed'); btn.disabled = false; }
        };
    }

    async function _ccOpenModalNow(clientName) {
        if (_isClientLink) return;
        if (!clientName) return;
        try { await _ccEnsureIdentity(); }
        catch (e) { if (e && e.status === 403) { try { showToast(e.message); } catch (_) {} } return; }
        _ccState.modal.open = true; _ccState.modal.client = clientName; _ccState.modal.loaded = false; _ccState.modal.credentials = [];
        let ov = document.getElementById('ccOverlay');
        if (!ov) {
            ov = document.createElement('div'); ov.id = 'ccOverlay'; ov.className = 'cal-import-overlay cc-overlay cc-sensitive-overlay open';
            if (typeof ov.setAttribute === 'function') ov.setAttribute('data-backdrop-dismiss', '');
            document.body.appendChild(ov);
        }
        ov.classList.add('open');
        ov.innerHTML = `<div class="cal-import-modal cc-modal-wide" role="dialog" aria-modal="true"><div class="cal-import-head"><button class="cal-import-x" type="button" onclick="_ccCloseModal()">×</button><h3>${_ccEsc(clientName)} credentials</h3><p>View, copy, and update this client's account access.</p></div><div class="cal-import-body" id="ccModalBody"></div><div class="cal-import-foot"><button class="cal-import-btn-primary" type="button" onclick="_ccOpenEdit('', 'modal')">Add credential</button></div></div>`;
        ov.onclick = e => { if (e.target === ov && ov._backdropPressBegan) _ccCloseModal(); };
        _ccPaintModal(); _ccLoadModal(false); _ccRevEnsureSubscribed('modal');
    }

    function _ccCloseModal() {
        const ov = document.getElementById('ccOverlay'); if (ov) ov.remove();
        _ccState.modal.open = false; _ccRevTeardown('modal');
    }

    async function _ccLoadModal(background) {
        if (!_ccState.modal.open || _ccState.modal.loading) return;
        _ccState.modal.loading = true; _ccState.modal.error = null;
        if (!background) _ccPaintModal();
        try {
            const slug = calClientSlug(_ccState.modal.client);
            const json = await _ccApi('list', { client_slug: slug });
            _ccState.modal.credentials = Array.isArray(json.credentials) ? json.credentials : [];
            _ccState.modal.loaded = true;
        } catch (e) { _ccState.modal.error = e && e.message ? e.message : String(e); }
        finally { _ccState.modal.loading = false; _ccPaintModal(); }
    }

    function _ccPaintModal() {
        const body = document.getElementById('ccModalBody'); if (!body) return;
        if (_ccState.modal.loading && !_ccState.modal.loaded) { body.innerHTML = _calLoaderHtml('Loading credentials…'); return; }
        if (_ccState.modal.error) { body.innerHTML = `<div class="cc-empty">${_ccEsc(_ccState.modal.error)}</div>`; return; }
        const rows = _ccState.modal.credentials || [];
        if (!rows.length) { body.innerHTML = '<div class="cc-empty">No credentials saved for this client yet.<br>Use Add credential to create the first one.</div>'; return; }
        body.innerHTML = `<div class="cc-card"><div class="cc-rows">${rows.map(r => _ccRowHtml(r, 'modal')).join('')}</div></div>`;
    }

    async function _ccRevEnsureSubscribed(scope) {
        if (!_calV2Ready()) return;
        const client = await _calV2Client(); if (!client) return;
        if (scope === 'kasper') {
            if (_ccRevKasperChannel) return;
            try {
                _ccRevKasperChannel = client.channel('client-credentials-rev-kasper').on('postgres_changes', { event: '*', schema: 'public', table: 'client_credentials_rev' }, () => _ccRevChanged('kasper')).subscribe();
            } catch (e) { console.warn('[Client credentials] realtime subscribe failed', e); _ccRevKasperChannel = null; }
        } else if (scope === 'modal') {
            const slug = calClientSlug(_ccState.modal.client);
            if (!slug) return;
            if (_ccRevModalChannel && _ccRevModalSlug === slug) return;
            _ccRevTeardown('modal'); _ccRevModalSlug = slug;
            try {
                _ccRevModalChannel = client.channel('client-credentials-rev-' + slug).on('postgres_changes', { event: '*', schema: 'public', table: 'client_credentials_rev', filter: 'client_slug=eq.' + slug }, () => _ccRevChanged('modal')).subscribe();
            } catch (e) { console.warn('[Client credentials] modal realtime subscribe failed', e); _ccRevModalChannel = null; _ccRevModalSlug = null; }
        }
    }

    function _ccRevChanged(scope) {
        const timerName = scope === 'kasper' ? '_ccRevKasperTimer' : '_ccRevModalTimer';
        if (scope === 'kasper' && _ccRevKasperTimer) clearTimeout(_ccRevKasperTimer);
        if (scope === 'modal' && _ccRevModalTimer) clearTimeout(_ccRevModalTimer);
        const run = function tick() {
            const since = Date.now() - _ccLastLocalWriteAt;
            if (since < CC_RT_SELF_ECHO_MS) {
                const wait = CC_RT_SELF_ECHO_MS - since;
                if (scope === 'kasper') _ccRevKasperTimer = setTimeout(tick, wait);
                else _ccRevModalTimer = setTimeout(tick, wait);
                return;
            }
            // Don't rebuild the list out from under an open client/platform
            // picker (the reassign dropdown) — defer briefly and re-check.
            if (_ccOpenSelectId) {
                if (scope === 'kasper') _ccRevKasperTimer = setTimeout(tick, 1200);
                else _ccRevModalTimer = setTimeout(tick, 1200);
                return;
            }
            // The list is live on the Kasper subtab AND on the standalone
            // /client-credentials page (same #ccKasperBody), so refresh when
            // either is showing it.
            if (scope === 'kasper') { _ccRevKasperTimer = null; if (_kasperState.tab === 'client-credentials' || document.getElementById('ccKasperBody')) _ccLoadKasper(true); }
            else { _ccRevModalTimer = null; if (_ccState.modal.open) _ccLoadModal(true); }
        };
        if (scope === 'kasper') _ccRevKasperTimer = setTimeout(run, 900);
        else _ccRevModalTimer = setTimeout(run, 900);
    }

    function _ccRevTeardown(scope) {
        if ((scope === 'kasper' || !scope) && _ccRevKasperTimer) { clearTimeout(_ccRevKasperTimer); _ccRevKasperTimer = null; }
        if ((scope === 'modal' || !scope) && _ccRevModalTimer) { clearTimeout(_ccRevModalTimer); _ccRevModalTimer = null; }
        if ((scope === 'kasper' || !scope) && _ccRevKasperChannel) {
            try { if (_calV2ClientObj && _calV2ClientObj.removeChannel) _calV2ClientObj.removeChannel(_ccRevKasperChannel); else if (_ccRevKasperChannel.unsubscribe) _ccRevKasperChannel.unsubscribe(); } catch {}
            _ccRevKasperChannel = null;
        }
        if ((scope === 'modal' || !scope) && _ccRevModalChannel) {
            try { if (_calV2ClientObj && _calV2ClientObj.removeChannel) _calV2ClientObj.removeChannel(_ccRevModalChannel); else if (_ccRevModalChannel.unsubscribe) _ccRevModalChannel.unsubscribe(); } catch {}
            _ccRevModalChannel = null; _ccRevModalSlug = null;
        }
    }

    /* ── Filming Plans ─────────────────────────────────────────────
       One row per client. The content bank counts every active calendar card
       that is either undated or dated today/future; archived and past-dated
       cards are excluded. This makes undated, already-created content visible
       without pretending it has a calendar slot. Plan months come from the
       Docs-tabs webhook when configured, else optional `plan_months` data.
       Source of Doc links: Supabase filming_plans rows. */
    function _filmsTodayISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function _filmsMonthKey(iso) { return String(iso || '').slice(0, 7); }       // 'YYYY-MM'
    function _filmsAddMonth(key, n) {
        const [y, m] = key.split('-').map(Number);
        const d = new Date(y, (m - 1) + n, 1);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    function _filmsDaysUntil(iso) {
        if (!iso) return null;
        const a = new Date(_filmsTodayISO() + 'T00:00:00');
        const b = new Date(iso + 'T00:00:00');
        if (isNaN(b)) return null;
        return Math.round((b - a) / 86400000);
    }
    function _filmsMonthShort(key) {
        const [y, m] = key.split('-').map(Number);
        if (!m) return key;
        return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
    }
    function _filmsMonthLong(key) {
        const [y, m] = key.split('-').map(Number);
        if (!m) return key;
        return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    function _filmsDatePretty(iso) {
        if (!iso) return '—';
        const d = new Date(iso + 'T00:00:00');
        if (isNaN(d)) return iso;
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    }
    function _filmsDocId(url) {
        const m = String(url || '').match(/\/d\/([A-Za-z0-9_-]+)/);
        return m ? m[1] : '';
    }
    // Best-effort 'YYYY-MM' from a Doc tab/section title like "July 2026",
    // "Jul '26", "2026-07", "07/2026", or a bare "July" (assume current year).
    function _filmsParseMonth(title) {
        const t = String(title || '').toLowerCase();
        const names = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
        let y = null, mo = null;
        let m = t.match(/(20\d{2})[-\/.](\d{1,2})/);
        if (m) { y = +m[1]; mo = +m[2]; }
        if (mo == null) { m = t.match(/\b(\d{1,2})[-\/.](20\d{2})\b/); if (m) { mo = +m[1]; y = +m[2]; } }
        if (mo == null) {
            for (const k in names) { if (t.includes(k)) { mo = names[k]; break; } }
            let ym = t.match(/(20\d{2})/);
            if (ym) y = +ym[1];
            else { ym = t.match(/'(\d{2})\b/); if (ym) y = 2000 + +ym[2]; }
        }
        if (!mo || mo < 1 || mo > 12) return null;
        if (!y) y = new Date().getFullYear();
        return `${y}-${String(mo).padStart(2,'0')}`;
    }

    // Limited-concurrency runner so we don't fire 24 calendar fetches at once.
    async function _filmsMapLimit(items, limit, fn) {
        const out = new Array(items.length);
        let idx = 0;
        async function worker() {
            while (idx < items.length) {
                const i = idx++;
                try { out[i] = await fn(items[i], i); }
                catch (e) { out[i] = null; }
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return out;
    }

    // Active content = every non-archived card which has not passed its
    // scheduled date. Undated cards count because they are content waiting to
    // be scheduled; past-dated cards are treated as already consumed.
    async function _filmsFetchContentBank(slug) {
        try {
            // v2: read this client's posts from Supabase instead of the Sheet
            // (gated on _calV2Ready() so v1 is byte-identical). _calV2FetchPosts
            // already falls back to the n8n calendar-get webhook on any Supabase
            // error, so the content bank can never blank. The bank is a computed
            // summary, so a refresh-on-open is enough —
            // no realtime subscription needed here.
            let json;
            if (_calV2Ready()) {
                json = await _calV2FetchPosts(slug);
            } else {
                const resp = await fetch(CALENDAR_GET_URL + '?client=' + encodeURIComponent(slug) + '&_t=' + Date.now());
                if (!resp.ok) return null;
                json = await resp.json();
            }
            if (!json || !json.ok || !Array.isArray(json.posts)) return null;
            const today = _filmsTodayISO();
            let total = 0;
            for (const p of json.posts) {
                if ((p.status || '').toLowerCase() === 'archived') continue;
                const d = _calCoerceDate(p.scheduled_date);
                if (!d || d >= today) total++;
            }
            return total;
        } catch (e) { return null; }
    }

    // Filming Doc tab lists come from the filming-plan-tabs Edge Function when the
    // runtime flag `filming_plan_tabs_source` says {"mode":"function"} (read fresh at
    // every Filming load and Refresh), and from the n8n webhook otherwise. The
    // default is n8n: a missing, unreadable or malformed flag, a slow read or a
    // failed function call all land on the old path, which stays the fallback.
    const FILMING_PLAN_TABS_EF_URL = CAL_SUPABASE_URL + '/functions/v1/filming-plan-tabs';
    const FILMING_TABS_SOURCE_FLAG_KEY = 'filming_plan_tabs_source';
    const FILMING_TABS_FLAG_TIMEOUT_MS = 2000;
    const FILMING_TABS_EF_TIMEOUT_MS = 20000;
    const FILMING_TABS_EF_BATCH = 50;   // the function accepts up to 60 Docs per call
    const FILMING_TABS_DOC_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;   // the function's own rule

    // A fresh read every time: never cached, never shared, never taken from boot.
    async function _filmsTabSource() {
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) return 'n8n';
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), FILMING_TABS_FLAG_TIMEOUT_MS) : null;
        try {
            const url = CAL_SUPABASE_URL + '/rest/v1/syncview_runtime_flags?select=value&limit=1&key=eq.'
                + encodeURIComponent(FILMING_TABS_SOURCE_FLAG_KEY);   // no _t= parameter: PostgREST reads any extra query parameter as a column filter and answers 400 (live, 2026-09-29); no-store already bypasses the HTTP cache
            const resp = await fetch(url, {
                headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Accept: 'application/json' },
                cache: 'no-store',
                signal: ctrl ? ctrl.signal : undefined,
            });
            if (!resp.ok) return 'n8n';
            const rows = await resp.json();
            const value = Array.isArray(rows) && rows[0] ? rows[0].value : null;
            return (value && typeof value === 'object' && value.mode === 'function') ? 'function' : 'n8n';
        } catch (e) {
            return 'n8n';
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // One request per batch of Docs instead of one per client. Returns a Map of
    // docId to its tab list for every Doc the function answered; anything else
    // (a bad Doc, a failed batch, a timeout) is simply absent and is read from n8n
    // by _filmsFetchTabMonths exactly as before.
    async function _filmsTabsFromFunction(docIds, refresh) {
        const found = new Map();
        const ids = Array.from(new Set((docIds || []).filter(id => FILMING_TABS_DOC_ID_RE.test(String(id || '')))));
        for (let i = 0; i < ids.length; i += FILMING_TABS_EF_BATCH) {
            const batch = ids.slice(i, i + FILMING_TABS_EF_BATCH);
            const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), FILMING_TABS_EF_TIMEOUT_MS) : null;
            try {
                const url = FILMING_PLAN_TABS_EF_URL + '?docs=' + batch.map(encodeURIComponent).join(',') + (refresh ? '&refresh=1' : '');
                const resp = await fetch(url, {
                    headers: _syncviewEfHeaders({ Accept: 'application/json' }, url),
                    cache: 'no-store',
                    signal: ctrl ? ctrl.signal : undefined,
                });
                if (!resp.ok) continue;
                const json = await resp.json();
                const docs = json && json.ok && json.docs && typeof json.docs === 'object' ? json.docs : null;
                if (!docs) continue;
                for (const id of batch) {
                    const entry = docs[id];
                    if (entry && entry.ok === true && Array.isArray(entry.tabs)) found.set(id, entry.tabs);
                }
            } catch (e) {
                /* this batch falls back to n8n */
            } finally {
                if (timer) clearTimeout(timer);
            }
        }
        return found;
    }

    // Turns a tab list into the months and titles the Filming view uses. The one
    // place that reads tabs, for the function's answer and the n8n webhook's alike.
    function _filmsTabResult(tabs) {
        const months = [];
        const titles = [];
        for (const tb of tabs) {
            const title = String(tb && (tb.title || tb.name || (tb.tabProperties && tb.tabProperties.title)) || '').trim();
            if (title) titles.push(title);
            const mk = _filmsParseMonth(title);
            if (mk) months.push(mk);
        }
        return { months, titles, read: true, error: '' };
    }

    // Plan months for one doc: from the function's batch answer when it has one,
    // otherwise via the optional Docs-tabs webhook. Keep the returned titles too:
    // a changed response shape or an unrecognised title must not silently turn
    // into the misleading word "unknown".
    async function _filmsFetchTabMonths(docId, prefetched) {
        const empty = { months: [], titles: [], read: false, error: '' };
        if (!FILMING_PLAN_TABS_URL || !docId) return empty;
        if (prefetched && prefetched.has(docId)) return _filmsTabResult(prefetched.get(docId));
        try {
            const resp = await fetch(FILMING_PLAN_TABS_URL + '?doc=' + encodeURIComponent(docId) + '&_t=' + Date.now());
            if (!resp.ok) return Object.assign({}, empty, { error: `Tab lookup failed (${resp.status})` });
            const json = await resp.json();
            // The webhook currently returns { tabs }, but accept the common
            // wrapper and raw Google Docs shapes as well so title data cannot
            // be dropped during a workflow response change.
            const tabs = Array.isArray(json) ? json
                : (json && (json.tabs
                    || (json.data && (json.data.tabs || json.data))
                    || (json.document && json.document.tabs)));
            if (!Array.isArray(tabs)) return Object.assign({}, empty, { error: 'Tab lookup returned no tab list' });
            return _filmsTabResult(tabs);
        } catch (e) { return Object.assign({}, empty, { error: 'Tab lookup failed' }); }
    }

    function _filmsLatestPlanMonth(row) {
        const months = Array.from((row && row.months) || []).filter(mk => /^20\d{2}-\d{2}$/.test(mk));
        return months.sort().pop() || '';
    }

    function _filmsPlanDetails(row) {
        const latestPlanMonth = _filmsLatestPlanMonth(row);
        if (!row.docUrl) return { latestPlanMonth: '', nextPlanMonth: '', daysUntilPlan: null, state: 'missing-doc' };
        if (!latestPlanMonth) {
            const state = row.tabRead ? 'unrecognised' : 'unavailable';
            return { latestPlanMonth: '', nextPlanMonth: '', daysUntilPlan: null, state };
        }
        // A June filming plan supplies July content, so the next plan is due in
        // August. A new tab then advances the cycle by another two months.
        const nextPlanMonth = _filmsAddMonth(latestPlanMonth, 2);
        const daysUntilPlan = _filmsDaysUntil(nextPlanMonth + '-01');
        return {
            latestPlanMonth,
            nextPlanMonth,
            daysUntilPlan,
            state: daysUntilPlan <= 0 ? 'overdue' : (daysUntilPlan <= FILMING_PLAN_SOON_DAYS ? 'soon' : 'covered'),
        };
    }

    function _filmsClassify(row) {
        const contentTotal = row.contentTotal;
        const plan = _filmsPlanDetails(row);
        Object.assign(row, plan);
        if (plan.state === 'missing-doc') return { status: 'red', reason: 'No filming Doc linked' };
        if (contentTotal == null) return { status: 'amber', reason: 'Content total unavailable' };
        if (contentTotal <= FILMING_CONTENT_RED_COUNT) return { status: 'red', reason: `${contentTotal} pieces of content` };
        if (plan.state === 'overdue') return { status: 'red', reason: `${_filmsMonthShort(plan.nextPlanMonth)} plan overdue` };
        if (plan.state === 'unavailable') return { status: 'amber', reason: row.tabError || 'Could not read filming-plan tabs' };
        if (plan.state === 'unrecognised') return { status: 'amber', reason: 'No dated filming-plan tab found' };
        if (plan.state === 'soon') return { status: 'amber', reason: `${_filmsMonthShort(plan.nextPlanMonth)} plan due in ${plan.daysUntilPlan}d` };
        if (contentTotal < FILMING_CONTENT_COVERED_COUNT) return { status: 'amber', reason: `${contentTotal} pieces of content` };
        return { status: 'green', reason: `Next plan: ${_filmsMonthShort(plan.nextPlanMonth)}` };
    }

    const _FILMS_RANK = { red: 0, amber: 1, green: 2 };

    function _filmsParseSheet(csvText) {
        const rows = parseCSV(csvText);
        const out = [];
        for (const r of rows) {
            const client = (r.client_name || r.client || '').trim();
            if (!client) continue;
            const docUrl = (r.doc_url || r.url || '').trim();
            const months = new Set();
            const manual = (r.plan_months || '').trim();
            if (manual) manual.split(/[,;|]/).forEach(s => { const mk = _filmsParseMonth(s) || (/^20\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null); if (mk) months.add(mk); });
            out.push({
                client, docUrl,
                docId: _filmsDocId(docUrl),
                notes: (r.notes || '').trim(),
                slug: calClientSlug(client),
                months,                 // may be augmented by the tabs webhook
                contentTotal: null,
                tabRead: false,
                tabTitles: [],
                tabError: '',
                latestPlanMonth: '',
                nextPlanMonth: '',
                daysUntilPlan: null,
                status: 'amber',
                reason: '',
            });
        }
        return out;
    }
    function _filmsRowsFromPlans(planRows) {
        const out = [];
        for (const plan of (planRows || [])) {
            const client = String(plan.clientName || plan.client_name || '').trim();
            if (!client) continue;
            const docUrl = String(plan.docUrl || plan.doc_url || '').trim();
            const months = new Set();
            const manual = String(plan.planMonths || plan.plan_months || '').trim();
            if (manual) manual.split(/[,;|]/).forEach(s => { const mk = _filmsParseMonth(s) || (/^20\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null); if (mk) months.add(mk); });
            out.push({
                client, docUrl,
                docId: String(plan.docId || plan.doc_id || _filmsDocId(docUrl) || '').trim(),
                notes: String(plan.notes || '').trim(),
                slug: calClientSlug(client),
                months,
                contentTotal: null,
                tabRead: false,
                tabTitles: [],
                tabError: '',
                latestPlanMonth: '',
                nextPlanMonth: '',
                daysUntilPlan: null,
                status: 'amber',
                reason: '',
            });
        }
        return out;
    }

    function _filmsLoadCache() {
        if (!_syncviewStaffIdentityForHeaders()) return null;
        try {
            const raw = localStorage.getItem(KASPER_FILMING_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.fetchedAt || Date.now() - parsed.fetchedAt > KASPER_FILMING_CACHE_MAX_AGE_MS) return null;
            (parsed.rows || []).forEach(r => { r.months = new Set(r.months || []); });
            // A copy saved before the tab source existed came from n8n. The source
            // that built it travels with it: see _filmsCacheStillValid.
            return parsed.rows ? { rows: parsed.rows, source: parsed.source === 'function' ? 'function' : 'n8n' } : null;
        } catch (e) { return null; }
    }
    function _filmsSaveCache(rows, source) {
        try {
            const slim = rows.map(r => Object.assign({}, r, { months: Array.from(r.months || []) }));
            localStorage.setItem(KASPER_FILMING_CACHE_KEY, JSON.stringify({ rows: slim, fetchedAt: Date.now(), source: source === 'function' ? 'function' : 'n8n' }));
        } catch (e) {}
    }
    // Filming rows already on screen, or in the 30 minute browser copy, were built
    // from one tab source. Reusing them without asking the flag again would keep
    // showing a function answer for up to 30 minutes after an operator flipped
    // filming_plan_tabs_source back to n8n (or the reverse). So every reuse is
    // preceded by a fresh flag read, and a copy built from the other source is
    // not reused: the page reloads instead. Returns the source now in force.
    async function _filmsCacheStillValid(builtFrom) {
        const now = await _filmsTabSource();
        return { ok: now === builtFrom, source: now };
    }

    async function _kasperRenderFilming() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        root.innerHTML = `
            <div class="kasper-toolbar">
                <div class="ked-meta-week" id="kfilmTitle">Filming Plans</div>
                <div class="ked-toolbar-actions">
                    <button type="button" class="ked-info-btn" id="kfilmInfoBtn" onclick="_filmsToggleInfo()" aria-label="About this view" title="About this view">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 9.7V6.4M7 4.5v.05"/></svg>
                    </button>
                    <button type="button" class="kasper-refresh-btn" id="kfilmRefresh" onclick="_kasperLoadFilming(true)">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1.5V4h-2.5M3.5 14.5V12H6"/></svg>
                        Refresh
                    </button>
                </div>
            </div>
            <div class="ked-info-panel" id="kfilmInfoPanel" hidden>
                <p><strong>What this is.</strong> One row per client, sorted by who needs a new filming plan soonest.</p>
                <p><strong>The dot.</strong>
                    <span class="kfilm-dot kfilm-red"></span> needs a plan now —
                    <span class="kfilm-dot kfilm-amber"></span> start one soon —
                    <span class="kfilm-dot kfilm-green"></span> covered.</p>
                <p><strong>Content</strong> is every active calendar card that is still available: undated cards and cards scheduled today or later. Archived and past-dated cards do not count.</p>
                <p><strong>The alert</strong> goes red for very low content or an overdue filming plan, amber when content is getting low or the next plan is due within two weeks. A monthly tab is treated as creating content for the following month.</p>
                <p class="ked-info-note">Plan links live in the <strong>Filming Plans</strong> source-of-truth tab. Month coverage is read from each Doc's tabs when the tabs webhook is configured; otherwise from an optional <code>plan_months</code> value.</p>
            </div>
            <div id="kfilmBody">${_svLoadingSkeletonHtml('kasper', { label: 'Loading filming plans' })}</div>`;
        const fresh = _kasperState.filmingData && (Date.now() - _kasperState.filmingLoadedAt < KASPER_FILMING_CACHE_MAX_AGE_MS);
        if (fresh && (await _filmsCacheStillValid(_kasperState.filmingSource || 'n8n')).ok) { _filmsPaint(); return; }
        await _kasperLoadFilming(false);
    }

    function _filmsToggleInfo() {
        const panel = document.getElementById('kfilmInfoPanel');
        if (panel) panel.hidden = !panel.hidden;
    }
    function _filmsToggleClient(idx) {
        const rows = _kasperState.filmingData && _kasperState.filmingData.rows;
        if (!rows || !rows[idx]) return;
        const client = rows[idx].client;
        _kasperState.filmingExpanded[client] = !_kasperState.filmingExpanded[client];
        _filmsPaint();
    }

    async function _kasperLoadFilming(forceRefresh) {
        const body = document.getElementById('kfilmBody');
        const btn  = document.getElementById('kfilmRefresh');

        // The tab source is read once per load, and before any cached copy is reused.
        let tabSource = null;
        if (!forceRefresh) {
            const cached = _filmsLoadCache();
            if (cached) {
                const check = await _filmsCacheStillValid(cached.source);
                tabSource = check.source;
                if (check.ok) {
                    _kasperState.filmingData = { rows: cached.rows };
                    _kasperState.filmingSource = cached.source;
                    _kasperState.filmingLoadedAt = Date.now();
                    _filmsPaint();
                    _kasperRefreshTabCounts();
                    return;
                }
                // Built from the other source: fall through and load afresh.
            }
        }

        if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
        if (body && (forceRefresh || !_kasperState.filmingData)) body.innerHTML = _svLoadingSkeletonHtml('kasper', { label: forceRefresh ? 'Refreshing filming plans' : 'Loading filming plans' });
        _kasperState.filmingLoading = true;
        _kasperState.filmingError = null;
        try {
            const plans = await (await svArea('templates')).fpEnsureLoaded(!!forceRefresh);
            const rows = _filmsRowsFromPlans(plans.rows || []);
            if (tabSource === null) tabSource = await _filmsTabSource();
            _kasperState.filmingSource = tabSource;
            if (!rows.length) {
                _kasperState.filmingData = { rows: [] };
                _kasperState.filmingLoadedAt = Date.now();
                _filmsPaint();
                return;
            }
            // Which source answers the Doc tabs is decided afresh on every load and
            // Refresh. In function mode one bulk request covers every Doc (Refresh
            // asks the function to re-read from Google); a Doc it could not answer
            // is read from n8n as before.
            const tabsFromFunction = tabSource === 'function'
                ? await _filmsTabsFromFunction(rows.map(r => r.docId), !!forceRefresh)
                : null;
            // Content bank (per client) + optional Doc-tab months (per doc), bounded concurrency.
            await _filmsMapLimit(rows, 5, async (row) => {
                const [contentTotal, tabResult] = await Promise.all([
                    _filmsFetchContentBank(row.slug),
                    _filmsFetchTabMonths(row.docId, tabsFromFunction),
                ]);
                row.contentTotal = contentTotal;
                row.tabRead = !!(tabResult && tabResult.read);
                row.tabTitles = (tabResult && Array.isArray(tabResult.titles)) ? tabResult.titles : [];
                row.tabError = (tabResult && tabResult.error) || '';
                if (tabResult && Array.isArray(tabResult.months)) tabResult.months.forEach(mk => row.months.add(mk));
                const cls = _filmsClassify(row);
                row.status = cls.status;
                row.reason = cls.reason;
            });
            rows.sort((a, b) => (_FILMS_RANK[a.status] - _FILMS_RANK[b.status])
                || ((a.contentTotal == null ? 1e9 : a.contentTotal) - (b.contentTotal == null ? 1e9 : b.contentTotal))
                || a.client.localeCompare(b.client));
            _kasperState.filmingData = { rows };
            _kasperState.filmingLoadedAt = Date.now();
            _filmsSaveCache(rows, tabSource);
            _filmsPaint();
        } catch (e) {
            _kasperState.filmingError = e && e.message ? e.message : String(e);
            const b = document.getElementById('kfilmBody');
            if (b) b.innerHTML = `<div class="kasper-empty">
                <div class="kasper-empty-title">Couldn't load filming plans</div>
                <div class="kasper-empty-sub">${_calEsc(_kasperState.filmingError)}</div>
                <div class="kasper-empty-sub" style="margin-top:8px;">Check the <strong>Filming Plans</strong> source-of-truth tab, then refresh.</div>
            </div>`;
        } finally {
            _kasperState.filmingLoading = false;
            if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
            // Covers the empty-rows and success paths (and is a harmless no-op on
            // error, where filmingData is guarded) — the Filming pill updates even
            // when the user is on another Kasper tab.
            _kasperRefreshTabCounts();
        }
    }

    function _filmsPaint() {
        const data = _kasperState.filmingData;
        const body = document.getElementById('kfilmBody');
        if (!body || !data) return;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (!rows.length) {
            body.innerHTML = `<div class="ked-empty-msg">
                No filming plans yet. Add client master Doc links in the <strong>Filming Plans</strong> source-of-truth tab, then refresh.
            </div>`;
            return;
        }
        // Month columns for the overview grid: last 4 + this month + next.
        const thisMonth = _filmsMonthKey(_filmsTodayISO());
        const gridMonths = [];
        for (let i = -4; i <= 1; i++) gridMonths.push(_filmsAddMonth(thisMonth, i));

        const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
        const summary = `<div class="kfilm-summary">
            <span class="kfilm-pill kfilm-red">${counts.red || 0} need a plan</span>
            <span class="kfilm-pill kfilm-amber">${counts.amber || 0} soon</span>
            <span class="kfilm-pill kfilm-green">${counts.green || 0} covered</span>
        </div>`;

        const list = rows.map((r, i) => {
            const expanded = !!_kasperState.filmingExpanded[r.client];
            const open = r.docUrl
                ? `<a class="kfilm-open" href="${_calEscAttr(r.docUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open Doc ↗</a>`
                : `<span class="kfilm-nodoc">No Doc linked</span>`;
            const calUrl = svRoute.clean(`/#calendar/${encodeURIComponent(r.slug)}`);
            const calBtn = `<a class="kfilm-open kfilm-cal" href="${_calEscAttr(calUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Calendar ↗</a>`;
            const contentTxt = r.contentTotal == null
                ? `<span class="kfilm-muted">Content total unavailable</span>`
                : `<strong>${r.contentTotal}</strong> piece${r.contentTotal === 1 ? '' : 's'} of content`;
            const rawTab = !r.latestPlanMonth && r.tabTitles && r.tabTitles.length ? r.tabTitles[0] : '';
            const planTxt = r.latestPlanMonth
                ? `Latest filming plan: <strong>${_filmsMonthShort(r.latestPlanMonth)}</strong> · ${_calEsc(r.reason)}`
                : (rawTab ? `Filming Doc tab: <strong>${_calEsc(rawTab)}</strong> · ${_calEsc(r.reason)}` : _calEsc(r.reason));
            let strip = '';
            if (expanded) {
                const cells = gridMonths.map(mk => {
                    const has = r.months && r.months.has(mk);
                    const cls = has ? 'kfilm-cell kfilm-cell--on' : 'kfilm-cell';
                    const inner = has && r.docUrl
                        ? `<a href="${_calEscAttr(r.docUrl)}" target="_blank" rel="noopener" title="${_calEscAttr(_filmsMonthLong(mk))}">${_filmsMonthShort(mk)}</a>`
                        : `<span title="${_calEscAttr(_filmsMonthLong(mk))}">${_filmsMonthShort(mk)}</span>`;
                    return `<div class="${cls}">${inner}</div>`;
                }).join('');
                const note = r.notes ? `<div class="kfilm-note">${_calEsc(r.notes)}</div>` : '';
                const cov = (r.months && r.months.size)
                    ? ''
                    : `<div class="kfilm-note">No month data yet — ${FILMING_PLAN_TABS_URL ? 'the Doc has no recognisable monthly tabs' : 'connect the tabs webhook or add a plan_months column to see coverage'}.</div>`;
                strip = `<div class="kfilm-strip"><div class="kfilm-grid">${cells}</div>${note}${cov}</div>`;
            }
            return `<div class="kfilm-row kfilm-${r.status}${expanded ? ' open' : ''}" onclick="_filmsToggleClient(${i})">
                <div class="kfilm-main">
                    <span class="kfilm-dot kfilm-${r.status}"></span>
                    <div class="kfilm-name">${_calEsc(r.client)}</div>
                    <div class="kfilm-runway">${contentTxt}</div>
                    <div class="kfilm-reason">${planTxt}</div>
                    <div class="kfilm-actions">${calBtn}${open}<span class="kfilm-caret">${expanded ? '▾' : '▸'}</span></div>
                </div>
                ${strip}
            </div>`;
        }).join('');

        body.innerHTML = summary + `<div class="kfilm-list">${list}</div>`;
    }

    /* ── Replies ───────────────────────────────────────────────────
       An inbox of cards (including ones he's already approved) where the SMM
       or client replied on one of Kasper's internal threads since he last
       caught up. Self-contained: shows the conversation and lets him reply or
       mark it read, without touching the approval-queue machinery. */
    function _kasperUpdateReplyCount() {
        const n = (_kasperState.replies || []).length;
        const el = document.querySelector('[data-kasper-count="replies"]');
        if (el) el.textContent = String(n);
    }
    /* Subtab count pills. Each tab's own render path only refreshes its OWN pill
       while that tab is mounted (e.g. _kasperPaintReview bails when the review
       body isn't on screen), so every OTHER tab sat on the placeholder dot until
       you visited it. These keep a real number on EVERY tab at all times:
       _kasperRefreshTabCounts paints from current state and touches ONLY the tiny
       count pills — never #kasperContent — so it's safe to call from any tab or a
       background load; _kasperEnsureAllTabCounts fetches the data behind every
       counted tab once on entry so the numbers appear without opening each tab. */
    function _kasperMarkOnboardingSeen() {
        const subs = _kasperOnboardingSubs();
        if (!Array.isArray(subs)) return;
        const newest = subs.reduce((stamp, submission) => {
            const next = _kasperOnboardingStamp(submission);
            return next > stamp ? next : stamp;
        }, '');
        try { if (newest) localStorage.setItem(KASPER_ONBOARDING_SEEN_KEY, newest); } catch (e) {}
        _kasperSetTabCount('onboarding', 0);
    }
    function _kasperEnsureAllTabCounts() {
        // The active tab's render path already kicked its own load and set a loading
        // flag synchronously (before its first await), so the loading/loaded guards
        // below dedupe it — we never double-fetch the tab that's showing. Each loader
        // calls _kasperRefreshTabCounts() when it lands.
        const review = _kasperState.loading ? _kasperReviewInFlight : _kasperLoadReview(true);   // feeds review + replies
        // On the review tab the other counts are background work: start them
        // once the queue has painted so they don't contend with its calendar
        // reads (speed map 2026-09-23 §5). Other tabs keep the eager start.
        if (_kasperState.tab === 'review' && review) {
            Promise.resolve(review).then(_kasperEnsureOtherTabCounts, _kasperEnsureOtherTabCounts);
            return;
        }
        _kasperEnsureOtherTabCounts();
    }
    function _kasperEnsureOtherTabCounts() {
        if (typeof _sxrKasperLoadQueue === 'function'
            && _kasperSamplesEnabled()
            && !_sxrKasperState.loading && !_sxrKasperState.loaded) {
            _sxrKasperLoadQueue();
        }
        if (!_kasperState.filmingLoading && !_kasperState.filmingData) _kasperLoadFilming(false);
        if (_ptoEnabled() && _syncviewStaffCan('pto-admin') && !_ptoAdminState.loading && !_ptoAdminState.overview) _ptoLoadAdmin(false);
        if (_syncviewStaffCan('onboarding')) {
            const loadOnboarding = tpl => {
                if (tpl.obvLoading() || Array.isArray(tpl.obvSubs())) return;
                tpl.obvSetMode('full');
                tpl.obvEnsureLoaded();
            };
            const tpl = svAreaApi('templates');
            if (tpl) loadOnboarding(tpl);
            else svArea('templates').then(loadOnboarding, () => {});
        }
    }
    let _kasperRepliesPaintRetry = null;
    function _kasperRenderReplies() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        // Don't rebuild the inbox out from under a reply being typed — the draft
        // survives in item._replyDraft, but an innerHTML rebuild drops focus/caret
        // mid-keystroke. Defer until the compose box blurs (mirrors _kasperPaintReview).
        const _ae = document.activeElement;
        if (_ae && _ae.tagName === 'TEXTAREA' && _ae.closest && _ae.closest('#kasperContent')) {
            if (_kasperRepliesPaintRetry) clearTimeout(_kasperRepliesPaintRetry);
            _kasperRepliesPaintRetry = setTimeout(_kasperRenderReplies, 1200);
            return;
        }
        if (_kasperRepliesPaintRetry) { clearTimeout(_kasperRepliesPaintRetry); _kasperRepliesPaintRetry = null; }
        _kasperUpdateReplyCount();
        // Landing straight on Replies (persisted tab) with nothing loaded yet —
        // kick a fetch; it re-renders this tab when done.
        if (!_kasperState.lastLoaded && !_kasperState.loading) _kasperLoadReview(true);
        // Newest conversation first: an inbox reads top-down, most-recent at the
        // top. Rank by the newest message's created_at (not updated_at) so that
        // resolving/editing an old thread doesn't bump a stale card to the top.
        // Sort a copy — _kasperState.replies order is preserved for everything else.
        const list = (_kasperState.replies || []).slice().sort((a, b) =>
            String(_calLatestMsgCreatedAt(b.post) || '').localeCompare(String(_calLatestMsgCreatedAt(a.post) || '')));
        if (!list.length) {
            const loadingNote = _kasperState.loading && !_kasperState.lastLoaded
                ? _svLoadingSkeletonHtml('kasper', { label: 'Checking for messages' })
                : `<div class="kasper-empty">
                    <div class="kasper-empty-icon"><svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg></div>
                    <div class="kasper-empty-title">No new messages</div>
                    <div class="kasper-empty-sub">When the SMM or client replies to one of your notes or tweaks, it shows up here.</div>
                </div>`;
            root.innerHTML = loadingNote;
            return;
        }
        root.innerHTML = `<div class="kasper-replies-list">${list.map(_kasperRepliesCardHtml).join('')}</div>`;
    }
    function _kasperRepliesCardHtml(item) {
        const p = item.post;
        const pid = p.id;
        const thumb = _calDeriveThumb(p);
        const seen = _kasperGetSeenAt(pid);
        // Group internal messages into threads (root + replies). Only threads
        // Kasper is part of (he authored or replied on) — a fresh SMM note or
        // change-request he never touched is not his conversation and stays out
        // of his Messages inbox, mirroring the inbox gate (_kasperHasUnreadReply).
        const threads = [];
        for (const c of _calComponentsFor(p)) {
            const list = _calCommentsFor(p, c);
            if (!Array.isArray(list)) continue;
            const byId = new Map();
            for (const m of list) if (m && m.id) byId.set(m.id, m);
            const owned = _kasperOwnedThreadRoots(list, byId);
            for (const m of list) {
                if (!m || m.deleted || m.parent_id) continue;           // roots only
                if (_calMsgAudience(m) !== 'internal') continue;        // internal threads only
                if (!owned.has(m.id)) continue;                         // only Kasper's own conversations
                const replies = list.filter(r => r && !r.deleted && r.parent_id === m.id)
                    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
                threads.push({ root: m, replies, comp: c });
            }
        }
        threads.sort((a, b) => String(a.root.created_at || '').localeCompare(String(b.root.created_at || '')));
        // A thread is "unread" if it carries a non-Kasper message newer than the
        // last time he caught up. By default only those show; his own threads
        // with no new reply are hidden behind a "Show all" toggle.
        const isUnreadThread = (t) => [t.root, ...t.replies].some(m =>
            m && m.role !== 'kasper' && String(m.updated_at || m.created_at || '') > seen);
        const showAll = !!item._showAllReplies;
        const unreadThreads = threads.filter(isUnreadThread);
        const shown = showAll ? threads : unreadThreads;
        const hiddenCount = threads.length - unreadThreads.length;
        const renderMsg = (m, isReply) => {
            const author = m.author || (m.role === 'client' ? 'Client' : m.role === 'kasper' ? 'Kasper' : 'SMM');
            const isNew = m.role !== 'kasper' && String(m.updated_at || m.created_at || '') > seen;
            const typeTag = (!isReply && _calMsgIsTweak(m))
                ? `<span class="cal-cm-type-tag is-tweak">Tweak${m.round ? ' #' + m.round : ''}</span>`
                : '';
            return `<div class="cal-review-comment cal-cm-${m.role || 'smm'}${isReply ? ' is-reply' : ''}${isNew ? ' is-new' : ''}">
                <div class="cal-review-comment-head"><strong>${_calEsc(author)}</strong>${typeTag}<span class="cal-review-comment-time">${_calEsc(_calFmtCommentTime(m.created_at))}</span></div>
                <div class="cal-review-comment-body">${_calEsc(m.body || '')}</div>
            </div>`;
        };
        const toggleHtml = showAll
            ? `<button type="button" class="kasper-replies-showall" onclick="_kasperRepliesToggleAll('${_calEscAttr(pid)}')">Show only new</button>`
            : (hiddenCount ? `<button type="button" class="kasper-replies-showall" onclick="_kasperRepliesToggleAll('${_calEscAttr(pid)}')">Show all messages</button>` : '');
        const threadHtml = toggleHtml + shown.map(t =>
            renderMsg(t.root, false) + t.replies.map(r => renderMsg(r, true)).join('')
        ).join('');
        const draft = item._replyDraft || '';
        const sendIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>`;
        const calUrl = svRoute.clean(`/#calendar/${encodeURIComponent(item.slug)}/${encodeURIComponent(pid)}`);
        return `<div class="kasper-replies-card" data-kasper-replies-pid="${_calEscAttr(pid)}">
            <div class="kasper-replies-head">
                ${thumb ? `<img class="kasper-replies-thumb" src="${_calEscAttr(thumb)}" alt="" onerror="this.style.display='none'">` : ''}
                <div class="kasper-replies-meta">
                    <div class="kasper-replies-client">${_calEsc(item.client)}${(() => {
                        const roles = new Set();
                        unreadThreads.forEach(t => [t.root, ...t.replies].forEach(m => {
                            if (m && m.role !== 'kasper' && String(m.updated_at || m.created_at || '') > seen) roles.add(m.role === 'client' ? 'client' : 'team');
                        }));
                        if (!roles.size) return '';
                        const who = [...roles].map(r => r === 'client' ? 'Client' : 'Team').join(' & ');
                        return `<span class="kasper-replies-newfrom">New from ${_calEsc(who)}</span>`;
                    })()}</div>
                    <div class="kasper-replies-title">${_calEsc(p.name || 'Untitled')}</div>
                </div>
                <a class="kasper-replies-open" href="${_calEscAttr(calUrl)}" target="_blank" rel="noopener" title="Open this card in the content calendar (new tab)">Open<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h6.5V10M12.5 3.5L6.5 9.5M11 9v3.5H3.5V5H7"/></svg></a>
                <button type="button" class="kasper-replies-read" onclick="_kasperMarkRepliesRead('${_calEscAttr(pid)}')" title="Mark this conversation as read and clear it from your messages">Mark as read</button>
            </div>
            <div class="kasper-replies-thread">${threadHtml || '<div class="cal-review-comment-empty">No messages.</div>'}</div>
            <div class="cal-review-panel-compose kasper-replies-compose">
                <textarea class="cal-review-textarea" placeholder="Reply to the team…" oninput="_kasperRepliesDraftInput(this,'${_calEscAttr(pid)}')">${_calEsc(draft)}</textarea>
                <button type="button" class="cal-review-tweak-btn" ${draft.trim() ? '' : 'disabled'} onclick="_kasperRepliesReply('${_calEscAttr(pid)}')">${sendIco}Reply</button>
            </div>
        </div>`;
    }
    function _kasperRepliesToggleAll(pid) {
        const item = (_kasperState.replies || []).find(x => x.post.id === pid);
        if (!item) return;
        item._showAllReplies = !item._showAllReplies;
        _kasperRenderReplies();
    }
    function _kasperRepliesDraftInput(ta, pid) {
        const item = (_kasperState.replies || []).find(x => x.post.id === pid);
        if (item) item._replyDraft = ta.value;
        const card = ta.closest('.kasper-replies-card');
        const btn = card && card.querySelector('.cal-review-tweak-btn');
        if (btn) btn.disabled = !ta.value.trim();
    }
    function _kasperMarkRepliesRead(pid) {
        const item = (_kasperState.replies || []).find(x => x.post.id === pid);
        if (item) _kasperMarkSeenAt(pid, _kasperRepliesSeenBasis(item.post) || _calLatestMsgAt(item.post));
        _kasperState.replies = (_kasperState.replies || []).filter(x => x.post.id !== pid);
        _kasperRenderReplies();
    }
    async function _kasperRepliesReply(pid) {
        const item = (_kasperState.replies || []).find(x => x.post.id === pid);
        if (!item) return;
        const body = String(item._replyDraft || '').trim();
        if (!body) return;
        // Continue the conversation on whichever component carries the latest
        // internal thread, and attach it AS A REPLY under that thread's root so
        // it stays threaded instead of starting a fresh comment.
        const comp = _kasperLatestInternalComp(item.post) || 'video';
        const list = _calCommentsFor(item.post, comp).slice();
        const byId = new Map();
        for (const m of list) if (m && m.id) byId.set(m.id, m);
        const owned = _kasperOwnedThreadRoots(list, byId);
        let parentRootId = null, latestT = '';
        for (const m of list) {
            if (!m || m.deleted) continue;
            const root = (m.parent_id && byId.has(m.parent_id)) ? byId.get(m.parent_id) : m;
            if (_calMsgAudience(root) !== 'internal') continue;
            if (!owned.has(root.id)) continue;   // thread the inbox card to one of Kasper's own conversations
            const t = String(m.updated_at || m.created_at || '');
            if (t > latestT) { latestT = t; parentRootId = root.id; }
        }
        const now = new Date().toISOString();
        list.push({
            id: _calMintCommentId(), parent_id: parentRootId, author: 'Kasper', role: 'kasper',
            is_tweak: false, audience: 'internal', body: body,
            created_at: now, updated_at: now, done: false, done_at: '', done_by: '',
        });
        _calSetCommentsFor(item.post, comp, list);
        item.post.updated_at = now;
        item._replyDraft = '';
        // Replying means he's caught up — clear it from the inbox.
        _kasperMarkSeenAt(pid, now);
        _kasperState.replies = (_kasperState.replies || []).filter(x => x.post.id !== pid);
        _kasperRenderReplies();
        try { await _kasperPersistPost(item); } catch (e) { /* surfaced on next load */ }
    }

    /* ── Review Session ─────────────────────────────────────────── */

    // ── Clients (Kasper › More › Pipeline & Admin) ──────────────────────────
    // Read-only list of every client's profile row, step 1 of the plan's
    // "Later: a Clients admin tab" (docs/plans/2026-09-24-sheets-to-supabase.md).
    // client_profiles grants the browser nothing; the rows come from
    // analytics-read's admin-only `list_client_profiles` action, which checks
    // the ADMIN role key. Editing (with an edit history, source='syncview')
    // goes through client-profile-write (admin only, Sheet first).
    const CA_READ_URL = CAL_SUPABASE_URL + '/functions/v1/analytics-read';
    const CA_GROUPS = [
        { title: 'Contact', fields: [['email', 'Email']] },
        { title: 'Social accounts', fields: [['instagram_handle', 'Instagram'], ['tiktok_handle', 'TikTok'], ['youtube_channel_id', 'YouTube channel']] },
        { title: 'Team channels', fields: [['slack_channel_id', 'Slack channel'], ['creative_channel_id', 'Creative channel']] },
        { title: 'Publishing', fields: [['upload_post_profile', 'Upload-Post profile'], ['postforme_account_id', 'Post for Me account']] },
    ];
    // Shown last, folded until opened (owner, 2026-09-25): long text nobody
    // needs at a glance.
    const CA_RESEARCH = { title: 'Content research', fields: [['content_description', 'Content description'], ['keywords', 'Keywords'], ['specific_keywords', 'Specific keywords'], ['competitors', 'Competitors']] };
    const CA_WRITE_URL = CAL_SUPABASE_URL + '/functions/v1/client-profile-write';
    // Long free text gets a textarea; everything else is one line.
    const CA_LONG_FIELDS = ['content_description', 'keywords', 'specific_keywords', 'competitors'];
    const _caState = { rows: [], authority: null, loaded: false, loading: false, error: null, search: '', selected: '', showArchived: false, edit: null };
    // Bumped by every purge, so a request started under one staff identity
    // can never repopulate the list after a sign-out or role change.
    let _caGeneration = 0;
    function _caPurgeSensitiveState() {
        _caGeneration++;
        Object.assign(_caState, { rows: [], authority: null, loaded: false, loading: false, error: null, search: '', selected: '', showArchived: false, edit: null });
        const body = document.getElementById('caBody');
        if (body) body.innerHTML = '';
        // The recently opened clients are this staff member's; drop them on sign-out.
        try { localStorage.removeItem(CA_RECENT_KEY); } catch (e) {}
    }

    function _caRender() {
        const el = document.getElementById('kasperContent');
        if (!el) return;
        el.innerHTML = `<div class="cc-wrap ca-wrap">
            <div class="cc-topbar">
                <div><h2 class="cc-title">Clients</h2><p class="cc-sub">Every client's details in one place. The Clients Info sheet is still the main copy: edits here are written to the sheet first, and the sheet is copied here daily.</p></div>
                <div class="cc-actions">
                    <input class="cc-search" id="caSearch" type="search" placeholder="Search name, handle, email…" value="${_calEscAttr(_caState.search)}" oninput="_caSetSearch(this.value)" aria-label="Search clients">
                    <button class="cc-btn" type="button" onclick="_caLoad(false)">Refresh</button>
                </div>
            </div>
            <div class="ca-body" id="caBody"></div>
        </div>`;
        _caPaint();
        if (!_caState.loaded && !_caState.loading) _caLoad(false);
    }

    async function _caLoad(background) {
        if (_caState.loading) return;
        const generation = _caGeneration;
        _caState.loading = true; _caState.error = null;
        if (!background) _caPaint();
        let ident = null;
        const stale = () => generation !== _caGeneration
            || _syncviewStaffIdentitySignature(_syncviewStaffIdentityForHeaders()) !== _syncviewStaffIdentitySignature(ident);
        try {
            ident = await _ccEnsureIdentity();
            const resp = await fetch(CA_READ_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': ident.key },
                body: JSON.stringify({ action: 'list_client_profiles' }),
            });
            let json = null;
            try { json = await resp.json(); } catch (e) { json = null; }
            if (stale()) return;
            if (resp.status === 401) throw new Error('This needs an Admin sign-in.');
            if (!resp.ok || !json || !json.ok) throw new Error('Could not load clients (' + ((json && json.error) || ('HTTP ' + resp.status)) + ').');
            _caState.rows = Array.isArray(json.clients) ? json.clients : [];
            _caState.authority = json.authority || null;
            _caState.loaded = true;
        } catch (e) {
            if (!stale()) _caState.error = e && e.message ? e.message : String(e);
        } finally {
            if (generation === _caGeneration) { _caState.loading = false; _caPaint(); }
        }
    }

    function _caSetSearch(v) { _caState.search = v || ''; _caPaint(); }

    // ---- Editing (admin only; the server re-checks the admin key and member) ----
    function _caEditRow() {
        const ed = _caState.edit;
        return ed ? (_caState.rows || []).find(r => r.slug === ed.slug) || null : null;
    }
    function _caEditChanges() {
        const ed = _caState.edit, r = _caEditRow();
        if (!ed || !r) return {};
        const out = {};
        for (const [k, v] of Object.entries(ed.draft)) {
            if (String(v).trim() !== String(r[k] == null ? '' : r[k]).trim()) out[k] = String(v);
        }
        return out;
    }
    function _caEditDirty() { return Object.keys(_caEditChanges()).length > 0; }
    function _caEditStart(slug) {
        if (!_syncviewStaffCan('clients-admin')) return;
        _caState.edit = { slug, draft: {}, saving: false, message: '', messageKind: '', conflictFields: null };
        _caPaint();
        const first = document.querySelector('#caDetail .ca-input');
        if (first && !(window.matchMedia && window.matchMedia('(max-width: 767px)').matches)) { try { first.focus(); } catch (e) {} }
    }
    function _caEditInput(el) {
        const ed = _caState.edit;
        if (!ed || !el) return;
        ed.draft[el.getAttribute('data-ca-field')] = el.value;
    }
    function _caEditCancel() {
        if (_caEditDirty() && !confirm('Discard your unsaved changes?')) return;
        _caState.edit = null;
        _caPaint();
    }
    function _caEditSay(message, kind) {
        if (!_caState.edit) return;
        _caState.edit.message = message;
        _caState.edit.messageKind = kind || '';
    }
    function _caReplaceRow(row) {
        if (!row || !row.slug) return;
        const i = (_caState.rows || []).findIndex(r => r.slug === row.slug);
        if (i >= 0) _caState.rows[i] = Object.assign({}, _caState.rows[i], row);
    }
    const CA_FIELD_LABELS = Object.fromEntries(CA_GROUPS.concat([CA_RESEARCH]).flatMap(g => g.fields));
    async function _caEditPost(action, extra) {
        const ident = await _ccEnsureIdentity();
        const resp = await _writeUiTrackSave('client_profile', ('client_profile_' + action).slice(0, 40), {}, () => fetch(CA_WRITE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': ident.key },
            body: JSON.stringify(Object.assign({ action, member_id: ident.member && ident.member.id }, extra || {})),
        }), { requireOk: true });
        let json = null;
        try { json = await resp.json(); } catch (e) { json = null; }
        return { resp, json: json || {}, ident };
    }
    async function _caEditSave() {
        const ed = _caState.edit, r = _caEditRow();
        if (!ed || !r || ed.saving) return;
        const changes = _caEditChanges();
        if (!Object.keys(changes).length) { _caEditSay('Nothing changed yet.', ''); _caPaint(); return; }
        const generation = _caGeneration;
        ed.saving = true; ed.conflictFields = null; _caEditSay('', ''); _caPaint();
        let out = null;
        try {
            out = await _caEditPost('update_client_profile', { slug: r.slug, expected_updated_at: r.updated_at, changes });
        } catch (e) {
            out = { resp: { status: 0 }, json: { error: e && e.message ? e.message : 'network_error' } };
        }
        if (generation !== _caGeneration || _caState.edit !== ed) return;
        ed.saving = false;
        const { resp, json } = out;
        const names = list => (list || []).map(k => CA_FIELD_LABELS[k] || k).join(', ');
        if (resp.status === 200 && json.ok) {
            _caReplaceRow(json.row);
            _caState.edit = null;
            _caPaint();
            if (typeof showToast === 'function') showToast('Saved to the sheet and SyncView');
            return;
        }
        const err = json.error || ('HTTP ' + resp.status);
        if (err === 'sheet_changed') {
            ed.conflictFields = json.fields || [];
            _caEditSay(`Someone changed this client in the sheet since you opened it (${_calEsc(names(json.fields))}). Nothing was saved. <button type="button" class="cc-btn" onclick="_caEditRefresh()">Load the sheet's values</button>`, 'error');
        } else if (err === 'client_profile_version_conflict') {
            _caReplaceRow(json.row);
            _caEditSay('Someone else saved this client a moment ago. Your changes are still here; check them and save again.', 'error');
        } else if (err === 'sheet_not_configured') {
            _caEditSay(`Saving is not switched on yet: the sheet has not been connected${json.service_account ? ` (share it with ${_calEsc(json.service_account)})` : ''}. Nothing was saved.`, 'error');
        } else if (err === 'sheet_not_shared' || err === 'sheet_not_editable') {
            _caEditSay('SyncView cannot edit the Clients Info sheet yet (it needs Editor access). Nothing was saved.', 'error');
            // Ask the server which Google account to share with (admin-only
            // status action) and add it to the message.
            _caEditPost('status').then(({ resp: sr, json: st }) => {
                if (generation !== _caGeneration || _caState.edit !== ed || !sr.ok || !st.ok || !st.service_account) return;
                _caEditSay(`SyncView cannot edit the Clients Info sheet yet. Share the sheet as <b>Editor</b> with <code class="ca-sa">${_calEsc(st.service_account)}</code>, then save again. Nothing was saved.`, 'error');
                _caPaint();
            }).catch(() => {});
        } else if (err === 'saved_to_sheet_only') {
            _caEditSay('Saved to the sheet, but SyncView\'s copy did not update. The daily copy will bring it in; refresh the list later.', 'error');
        } else if (resp.status === 401 || resp.status === 403) {
            _caEditSay('Saving needs an Admin sign-in.', 'error');
        } else {
            _caEditSay('Could not save (' + _calEsc(err) + '). Nothing was changed.', 'error');
        }
        _caPaint();
    }
    async function _caEditRefresh() {
        const ed = _caState.edit, r = _caEditRow();
        if (!ed || !r || ed.saving) return;
        const generation = _caGeneration;
        ed.saving = true; _caPaint();
        let out = null;
        try { out = await _caEditPost('refresh_from_sheet', { slug: r.slug }); } catch (e) { out = { resp: { status: 0 }, json: {} }; }
        if (generation !== _caGeneration || _caState.edit !== ed) return;
        ed.saving = false;
        if (out.resp.status === 200 && out.json.ok) {
            _caReplaceRow(out.json.row);
            // Keep what the editor typed, except in the fields the sheet changed.
            for (const k of ed.conflictFields || []) delete ed.draft[k];
            ed.conflictFields = null;
            _caEditSay('Loaded the latest values from the sheet. Your other changes are kept; save when ready.', '');
        } else {
            _caEditSay('Could not load the sheet (' + _calEsc(out.json.error || ('HTTP ' + out.resp.status)) + ').', 'error');
        }
        _caPaint();
    }
    function _caToggleArchived() { _caState.showArchived = !_caState.showArchived; _caPaint(); }
    function _caSelect(slug) {
        if (_caState.edit && _caState.edit.slug !== slug && _caEditDirty() && !confirm('Discard your unsaved changes to this client?')) return;
        if (_caState.edit && _caState.edit.slug !== slug) _caState.edit = null;
        _caState.selected = slug || '';
        if (slug) _caRememberOpened(slug);
        _caPaint();
        const d = document.getElementById('caDetail');
        if (d && window.matchMedia && window.matchMedia('(max-width: 767px)').matches) { try { d.scrollIntoView({ block: 'start' }); } catch (e) {} }
    }

    /* When Kasper searches, the clients he opened most recently come first;
       clients he never opened follow in alphabetical order. Kept in this
       browser only (a convenience, not shared state). */
    function _caRecentMap() {
        try { const m = JSON.parse(localStorage.getItem(CA_RECENT_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
    }
    function _caRememberOpened(slug) {
        const m = _caRecentMap();
        m[slug] = Date.now();
        const keep = Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, 100);
        const out = {}; for (const k of keep) out[k] = m[k];
        try { localStorage.setItem(CA_RECENT_KEY, JSON.stringify(out)); } catch (e) {}
    }
    function _caFiltered() {
        const q = String(_caState.search || '').trim().toLowerCase();
        const rows = (_caState.rows || []).filter(r => {
            if (r.archived_at && !_caState.showArchived) return false;
            if (!q) return true;
            return [r.display_name, r.slug, r.email, r.instagram_handle, r.tiktok_handle, r.youtube_channel_id]
                .some(v => String(v || '').toLowerCase().includes(q));
        });
        if (!q) return rows;
        const recent = _caRecentMap();
        const name = r => String(r.display_name || r.slug || '');
        return rows.slice().sort((a, b) => {
            const ta = Number(recent[a.slug]) || 0, tb = Number(recent[b.slug]) || 0;
            if (ta !== tb) return tb - ta;
            return name(a).localeCompare(name(b), undefined, { sensitivity: 'base' });
        });
    }

    function _caWhen(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function _caInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    function _caValue(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return '<span class="ca-empty">Not set</span>';
        if (/^https?:\/\//i.test(s)) return `<a href="${_calEscAttr(s)}" target="_blank" rel="noopener">${_calEsc(s)}</a>`;
        return _calEsc(s);
    }

    function _caDetailHtml(r) {
        if (!r) return `<div class="ca-detail-empty">Choose a client to see their details.</div>`;
        const ed = _caState.edit && _caState.edit.slug === r.slug ? _caState.edit : null;
        const input = (k, label) => {
            const v = k in ed.draft ? ed.draft[k] : (r[k] == null ? '' : String(r[k]));
            const flag = ed.conflictFields && ed.conflictFields.includes(k) ? ' is-conflict' : '';
            const attrs = `id="caIn_${k}" data-ca-field="${k}" oninput="_caEditInput(this)" ${ed.saving ? 'disabled' : ''} aria-label="${_calEscAttr(label)}"`;
            return CA_LONG_FIELDS.includes(k)
                ? `<textarea class="ca-input${flag}" rows="3" ${attrs}>${_calEsc(v)}</textarea>`
                : `<input class="ca-input${flag}" type="text" autocomplete="off" spellcheck="false" value="${_calEscAttr(v)}" ${attrs}>`;
        };
        const fieldsHtml = g => `<dl>${g.fields.map(([k, label]) => ed
            ? `<div class="ca-field${CA_LONG_FIELDS.includes(k) ? ' is-wide' : ''}"><dt><label for="caIn_${k}">${_calEsc(label)}</label></dt><dd>${input(k, label)}</dd></div>`
            : `<div class="ca-field"><dt>${_calEsc(label)}</dt><dd>${_caValue(r[k])}</dd></div>`).join('')}</dl>`;
        const groups = CA_GROUPS.map(g => `<section class="ca-group">
                <h4>${_calEsc(g.title)}</h4>
                ${fieldsHtml(g)}
            </section>`).join('');
        const research = `<details class="ca-group ca-fold"${ed ? ' open' : ''}><summary><h4>${_calEsc(CA_RESEARCH.title)}</h4></summary>${fieldsHtml(CA_RESEARCH)}</details>`;
        const extra = r.extra && typeof r.extra === 'object' ? Object.entries(r.extra).filter(([, v]) => String(v == null ? '' : v).trim()) : [];
        const extraHtml = extra.length ? `<section class="ca-group"><h4>Other sheet columns</h4><dl>${extra.map(([k, v]) => `<div class="ca-field"><dt>${_calEsc(k)}</dt><dd>${_caValue(v)}</dd></div>`).join('')}</dl></section>` : '';
        const source = r.source === 'syncview' ? 'Edited in SyncView' : 'From the Clients Info sheet';
        return `<button type="button" class="ca-back" onclick="_caSelect('')">‹ All clients</button>
            <header class="ca-detail-head">
                <span class="ca-avatar" aria-hidden="true">${_calEsc(_caInitials(r.display_name))}</span>
                <div>
                    <h3>${_calEsc(r.display_name || r.slug)}</h3>
                    <div class="ca-meta">${r.archived_at ? `<span class="ca-pill is-archived">Archived ${_calEsc(_caWhen(r.archived_at))}</span>` : ''}<span class="ca-pill">${_calEsc(source)}</span></div>
                </div>
                ${!ed && !r.archived_at && _syncviewStaffCan('clients-admin') ? `<button type="button" class="cc-btn ca-edit-btn" onclick="_caEditStart('${_calEscAttr(r.slug)}')">Edit</button>` : ''}
            </header>
            ${ed && ed.message ? `<div class="ca-msg${ed.messageKind ? ' is-' + ed.messageKind : ''}" role="${ed.messageKind === 'error' ? 'alert' : 'status'}">${ed.message}</div>` : ''}
            ${groups}${ed ? '' : extraHtml}${research}
            ${ed ? `<div class="ca-editbar">
                <span class="ca-editnote">Saves to the Clients Info sheet first, then SyncView.</span>
                <button type="button" class="cc-btn" onclick="_caEditCancel()" ${ed.saving ? 'disabled' : ''}>Cancel</button>
                <button type="button" class="cc-btn primary ca-save" onclick="_caEditSave()" ${ed.saving ? 'disabled' : ''}>${ed.saving ? 'Saving…' : 'Save'}</button>
            </div>` : ''}
            <footer class="ca-prov">Last updated ${_calEsc(_caWhen(r.updated_at) || 'unknown')} by ${_calEsc(r.updated_by || 'unknown')}${r.sheet_synced_at ? ` · copied from the sheet ${_calEsc(_caWhen(r.sheet_synced_at))}` : ''}</footer>`;
    }

    function _caPaint() {
        const body = document.getElementById('caBody');
        if (!body) return;
        if (_caState.loading && !_caState.loaded) { body.innerHTML = `<div class="ca-status">Loading clients…</div>`; return; }
        if (_caState.error && !_caState.loaded) { body.innerHTML = `<div class="ca-status is-error">${_calEsc(_caState.error)} <button class="cc-btn" type="button" onclick="_caLoad(false)">Try again</button></div>`; return; }
        const rows = _caFiltered();
        const all = _caState.rows || [];
        const archivedCount = all.filter(r => r.archived_at).length;
        const selected = all.find(r => r.slug === _caState.selected) || null;
        const list = rows.length ? rows.map(r => `<li><button type="button" class="ca-row${selected && selected.slug === r.slug ? ' is-active' : ''}${r.archived_at ? ' is-archived' : ''}" onclick="_caSelect('${_calEscAttr(r.slug)}')">
                <span class="ca-avatar" aria-hidden="true">${_calEsc(_caInitials(r.display_name))}</span>
                <span class="ca-row-text"><span class="ca-row-name">${_calEsc(r.display_name || r.slug)}</span><span class="ca-row-sub">${_calEsc([r.instagram_handle, r.email].filter(Boolean).join(' · ') || 'No handle or email yet')}</span></span>
                ${r.source === 'syncview' ? '<span class="ca-dot" title="Edited in SyncView"></span>' : ''}
            </button></li>`).join('') : `<li class="ca-none">No clients match “${_calEsc(_caState.search)}”.</li>`;
        const authority = _caState.authority && _caState.authority.source === 'syncview' ? 'SyncView is the main copy.' : 'The sheet is the main copy.';
        const staleNote = _caState.error ? `<div class="ca-stale" role="alert">Refresh failed: ${_calEsc(_caState.error)} Showing the last list loaded. <button class="cc-btn" type="button" onclick="_caLoad(false)">Try again</button></div>` : '';
        body.innerHTML = staleNote + `<div class="ca-split${selected ? ' has-selection' : ''}">
                <div class="ca-list-pane">
                    <div class="ca-list-head"><span>${rows.length} of ${all.length - (_caState.showArchived ? 0 : archivedCount)} clients</span>${archivedCount ? `<button type="button" class="ca-link" onclick="_caToggleArchived()">${_caState.showArchived ? 'Hide' : 'Show'} ${archivedCount} archived</button>` : ''}</div>
                    <ul class="ca-list">${list}</ul>
                    <div class="ca-authority">${_calEsc(authority)}</div>
                </div>
                <div class="ca-detail" id="caDetail">${_caDetailHtml(selected)}</div>
            </div>`;
    }
    async function _kasperRenderReview() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        const hasCached = !!_kasperState.lastLoaded;
        root.innerHTML = `
            <span class="app-refresh-pill" id="kasperReviewRefreshPill" hidden><span class="cal-refresh-spin"></span>Refreshing…</span>
            <span id="kasperReviewCount" hidden></span>
            <div id="kasperReviewBody">${hasCached
                ? '' /* paint cached state right after the toolbar */
                : _svLoadingSkeletonHtml('kasper', { label: 'Loading Kasper review' })}</div>`;
        if (hasCached) _kasperPaintReview();
        // Always force-refresh on entry. The 5-minute per-client cache
        // is fine for in-session navigation but on the initial Kasper
        // page load — exactly when an SMM has likely been making
        // changes elsewhere — we want fresh sheet data, not whatever
        // was cached during a previous session. The pill shows during
        // the fetch so the SMM/Kasper can see what's happening.
        _kasperLoadReview(true);
    }

    // The in-flight review load, so background tab counts can queue behind it.
    let _kasperReviewInFlight = null;
    function _kasperLoadReview(forceRefresh) {
        const run = _kasperLoadReviewRun(forceRefresh);
        _kasperReviewInFlight = run;
        const clear = () => { if (_kasperReviewInFlight === run) _kasperReviewInFlight = null; };
        run.then(clear, clear);
        return run;
    }
    async function _kasperLoadReviewRun(forceRefresh) {
        const body = document.getElementById('kasperReviewBody');
        const btn  = document.getElementById('kasperReviewRefresh');
        if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
        // Only blank the body to a spinner when there's literally nothing to
        // show. Once cached/loaded cards are on screen, refreshes surface
        // through the same glass pill the SMM calendar uses (top-center,
        // sliding in over the toolbar) so the affordance is consistent
        // across the app — plus the spinning Refresh button.
        const hasContent = _kasperState.items.length > 0 || _kasperState.history.length > 0;
        if (!hasContent && body) body.innerHTML = _svLoadingSkeletonHtml('kasper', { label: 'Loading Kasper review' });
        else { const pill = document.getElementById('kasperReviewRefreshPill'); if (pill) pill.hidden = false; }

        _kasperState.loading = true;
        _kasperState.error = null;
        // Capture the current generation so a user mutation during the
        // await can invalidate this load before its results are applied.
        _kasperSetLoadGen(_kasperLoadGen + 1);
        const myGen = _kasperLoadGen;

        try {
            // SMM sheet + every client's calendar in parallel, but only the
            // calendars gate the paint: the SMM name is card decoration, so the
            // queue paints with the last known map (entry cache) and the fresh
            // sheet re-decorates it when it lands (speed map 2026-09-23 §5).
            // forceRefresh propagates so the Refresh button bypasses the 5-min cache.
            const smmPromise = _kasperLoadSMMMap();
            const fetched = await _kasperFetchAllRelevantPosts(forceRefresh);
            const smmMap = _kasperState.smmByClient instanceof Map ? _kasperState.smmByClient : new Map();
            // If the user clicked approve / submit tweak / dismiss while we
            // were fetching, _kasperLoadGen was bumped past myGen. Discard
            // this stale response — the next load (triggered by the
            // mutation's persist or the next poll tick) will repaint with
            // fresh data.
            if (myGen !== _kasperLoadGen) return;
            smmPromise.then(fresh => _kasperApplySMMMap(fresh, myGen));
            // Honour explicit "Done reviewing" dismissals across refreshes.
            // The fetch re-includes any card with an unresolved Kasper tweak,
            // so without this a dismissed card would pop straight back into
            // the queue. Prune dismissals whose card has fully left Kasper's
            // purview (tweak resolved / status moved on) so the set can't
            // grow without bound — those ids are simply absent from the fetch.
            if (!_kasperState.dismissed || typeof _kasperState.dismissed !== 'object') _kasperState.dismissed = {};
            if (!_kasperState.closed || typeof _kasperState.closed !== 'object') _kasperState.closed = {};
            const _fetchedIds = new Set(fetched.queue.map(it => it.post.id));
            for (const id of Object.keys(_kasperState.dismissed)) {
                if (!_fetchedIds.has(id)) delete _kasperState.dismissed[id];
            }
            // Explicit X-closed cards: keep them hidden while they're still in
            // the fetched queue (the component is sitting at Kasper Approval and
            // nothing changed), but drop the "closed" flag the moment the card
            // falls out of the queue — the SMM moved it past/back from Kasper.
            // When it later returns to Kasper Approval it's a fresh ask, so it
            // reappears. This is the "change of status" rule the user asked for.
            for (const id of Object.keys(_kasperState.closed)) {
                if (!_fetchedIds.has(id)) delete _kasperState.closed[id];
            }
            // Finished cards stay in the queue (they bucket into "Tweaks pending"
            // via _kasperIsFinished); only X-closed cards are filtered out here.
            const items = fetched.queue.filter(it => !_kasperIsClosed(it.post));
            // Decorate posts with SMM info.
            for (const it of items) {
                const slug = wlNormalizeClient(it.client);
                it.smm = smmMap.get(slug) || null;
            }
            // Oldest hand-off first: when each card was sent to Kasper, read
            // from calendar_post_events (see _kasperSentAtMs). A failed read
            // falls back to the status stamps already on the post.
            let sentEvents = [];
            try { sentEvents = await _kasperFetchSentEvents(items); } catch (_) { sentEvents = []; }
            if (myGen !== _kasperLoadGen) return;
            _kasperSortBySentAt(items, sentEvents);
            // Preserve expanded / drafts / touched-comps across refreshes.
            // Also use last-write-wins for the post itself: if local stamped
            // updated_at after the sheet's, keep the local post — but only
            // while the local stamp is very recent. The point of preferring
            // local was to protect an in-flight tweak/approve submit from
            // being briefly overwritten by a slower server response on the
            // same load cycle. Long-lived local state (cache resurrected
            // hours later, or a save that never got reconciled) silently
            // hides server-side status progressions and was the bug behind
            // panels still saying "Changes requested" after the SMM had
            // already moved the component past Kasper. We cap the
            // local-preference window at 30 s.
            const KASPER_LOCAL_PREFER_MS = 30 * 1000;
            const nowMs = Date.now();
            const prevById = new Map(_kasperState.items.map(x => [x.post.id, x]));
            for (const it of items) {
                const local = prevById.get(it.post.id);
                if (!local) continue;
                if (local._expanded) it._expanded = true;
                if (local._drafts) it._drafts = Object.assign({ video: '', graphic: '', caption: '' }, local._drafts);
                if (local._touchedComps) it._touchedComps = local._touchedComps;
                // Last-write-wins on the post itself, time-bound.
                const lT = Date.parse((local.post && local.post.updated_at) || '');
                const fT = Date.parse(it.post.updated_at || '');
                const localRecent = isFinite(lT) && (nowMs - lT) < KASPER_LOCAL_PREFER_MS;
                if (local.post && local.post._writeUiRetrySourceAt) it.post = local.post;
                else if (localRecent && isFinite(fT) && lT > fT) it.post = local.post;
            }
            // No more rescue loop: the fresh-fetch filter above already
            // accepts both Kasper Approval AND Tweaks-Needed-with-tweak
            // cards via _calPostKasperVisible. Re-injecting old items
            // from _kasperState.items only ever re-injects stale post
            // data — exactly the bug that left "Changes requested"
            // panels lingering after the SMM had moved a component to
            // Client Approval. Fresh server state is the source of
            // truth on every refresh.
            _kasperState.items = items;
            // Replies inbox — decorate with SMM info and preserve any in-flight
            // reply draft across the refresh. Not filtered by dismissals; it's
            // an inbox of unread conversation, independent of the approval queue.
            const repliesIn = (fetched.replies || []);
            for (const it of repliesIn) it.smm = smmMap.get(wlNormalizeClient(it.client)) || null;
            const _prevReplies = new Map((_kasperState.replies || []).map(x => [x.post.id, x]));
            for (const it of repliesIn) {
                const lo = _prevReplies.get(it.post.id);
                if (lo && lo._replyDraft) it._replyDraft = lo._replyDraft;
            }
            _kasperState.replies = repliesIn;
            // Merge server-known history with the local log so a refresh keeps
            // recent approvals visible even if the sheet doesn't have a column
            // for kasper_approved_at yet.
            _kasperState.history = _kasperMergeHistory(fetched.history, _kasperLoadHistoryLog());
            // Cards nominally at Kasper Approval with nothing attached. Not
            // review work -- reported so the hand-off cannot fail in silence.
            _kasperState.stranded = Array.isArray(fetched.stranded) ? fetched.stranded : [];
            // Clients whose calendar could not be read at all. Their cards are
            // not in the queue and nobody can tell by looking, so say it.
            _kasperState.unloaded = Array.isArray(fetched.unloaded) ? fetched.unloaded : [];
            _kasperState.lastLoaded = Date.now();
            _kasperPersistCache();
            _kasperPaintReview();
            _kasperUpdateReplyCount();
            _kasperRefreshTabCounts();   // keep review/samples/filming pills live even when those tabs aren't mounted
            if (_kasperState.tab === 'replies') _kasperRenderReplies();
        } catch (e) {
            _kasperState.error = e && e.message ? e.message : String(e);
            const body2 = document.getElementById('kasperReviewBody');
            if (body2) body2.innerHTML = `<div class="kasper-empty"><div class="kasper-empty-title">Couldn't load the queue</div><div class="kasper-empty-sub">${_calEsc(_kasperState.error)}</div></div>`;
        } finally {
            _kasperState.loading = false;
            if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
            const pill = document.getElementById('kasperReviewRefreshPill');
            if (pill) pill.hidden = true;
        }
    }

    // Late half of _kasperLoadReview: the fresh SMM sheet arrived after the queue
    // painted. Same end state as awaiting it up front, just repainted once.
    function _kasperApplySMMMap(smmMap, gen) {
        if (gen !== _kasperLoadGen) return;
        _kasperState.smmByClient = smmMap;
        const smmFor = it => smmMap.get(wlNormalizeClient(it.client)) || null;
        for (const it of _kasperState.items) it.smm = smmFor(it);
        for (const it of (_kasperState.replies || [])) it.smm = smmFor(it);
        _kasperPersistCache();
        if (_kasperIsReviewMounted()) _kasperPaintReview();
        if (_kasperState.tab === 'replies') _kasperRenderReplies();
    }


    const KASPER_CAL_CONCURRENCY = 5;             // Sheets-backed calendar-get hits Google's per-user quota beyond ~5 in flight.
    function _kasperCalCacheRead(slug) {
        try {
            const raw = localStorage.getItem(_kasperCalCacheKey(slug));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.savedAt || !parsed.data) return null;
            if (Date.now() - parsed.savedAt >= KASPER_CAL_CACHE_TTL) return null;
            return parsed.data;
        } catch { return null; }
    }
    /* ONE KEY PER CLIENT, never evicted, was the shape. _kasperFetchAllRelevantPosts
       walks EVERY allowed client and writes a full calendar payload for each, so
       the store grew with the roster and never shrank -- a client seen once in
       July still held a payload in August. The round-3 tester measured 34 of
       these alongside a 4.6MB cache, which together reached the ~10MB Chrome
       per-origin ceiling and broke Create Post outright (PR 1186). Round 1 saw
       the same pressure as a harmless console warning; it escalated to blocking
       a core write path because nothing here was bounded.

       Two bounds, because either alone leaves a hole. AGE clears what the
       reader would refuse anyway -- entries past the TTL are already dead
       weight. COUNT is what actually caps growth, since a roster larger than
       the cap would otherwise stay live and unbounded. Newest kept, oldest
       dropped, and the slug being written is never a candidate for eviction. */
    function _kasperCalCacheWrite(slug, json) {
        const payload = JSON.stringify({ data: json, savedAt: Date.now() });
        _kasperCalCachePrune(slug);
        try {
            localStorage.setItem(_kasperCalCacheKey(slug), payload);
        } catch {
            /* Still full after pruning: something else owns the space. Drop this
               this client stale entry and give up on caching rather than
               leaving a half-written key -- a cache miss costs one fetch, while
               a full store costs Create Post. */
            try { localStorage.removeItem(_kasperCalCacheKey(slug)); } catch {}
        }
    }

    async function _kasperFetchAllRelevantPosts(forceRefresh) {
        // Fetch every allowed client's calendar and split the result into the
        // live review queue ("Kasper Approval") and a history slice (anything
        // Kasper has previously approved, identified by either an explicit
        // kasper_approved_at timestamp on the row or — fallback for sheets
        // without that column yet — a status that comes after Kasper Approval
        // in the lifecycle). Throttled to KASPER_CAL_CONCURRENCY in-flight to
        // avoid stampeding the Google-Sheets-backed calendar-get webhook.
        const extract = (client, json) => {
            const slug = wlNormalizeClient(client);
            // Filter Archived BEFORE the Linear-issue dedupe — otherwise
            // an old archived row can win the dedupe (highest order_index)
            // over a freshly re-imported row sharing the same Linear URL,
            // hiding the active card from Kasper's queue entirely. We
            // ALSO load the per-client archive ledger so cards the SMM
            // just archived (where the sheet hasn't yet propagated
            // status=Archived) are excluded inside the loop below.
            const archivedRefs = _calArchivedRefs(slug);
            const rawPosts = _calDedupeByLinearIssue(((json && json.posts) || [])
                .filter(p => (p && p.status || '').toLowerCase() !== 'archived'));
            const queue = [];
            const history = [];
            const replies = [];
            const stranded = [];
            const seenIds = new Set();
            for (const raw of rawPosts) {
                if (!raw || !raw.id || seenIds.has(raw.id)) continue;
                seenIds.add(raw.id);
                const status = _calNormStatus(raw.status);
                raw.status = status;
                if (status === 'Archived' || _calIsArchivedRef(raw, archivedRefs)) continue;
                raw.scheduled_date = _calCoerceDate(raw.scheduled_date);
                raw.comments = _calLoadComments(raw);
                // Per-component gating, driven by the same _calPostKasperVisible
                // rule the card body uses: a card lands in Kasper's queue
                // when at least one component is still at Kasper Approval,
                // OR it's at Tweaks Needed with an unresolved Kasper tweak.
                // Anything else (For SMM Approval, Client Approval, Approved,
                // Posted) drops the card immediately — even if Kasper hasn't
                // hit Done reviewing yet — because the SMM has moved it past
                // Kasper's purview.
                _calMigratePostShape(raw);
                // Base watermark for the server's 3-way comment merge: the
                // server version this browser last saw.
                raw._baseAt = String(raw.updated_at || '');
                // Scalar snapshot for the field-level persist patch (so Kasper's
                // write only carries the columns HE changes — see _kasperPatchSnapshot).
                raw._patchBase = _kasperPatchSnapshot(raw);
                const hasKasperWork = _calPostKasperVisible(raw);
                // Content gate: skip cards that have NEITHER a video
                // (asset_url) NOR a graphic/thumbnail (thumbnail_url).
                // These are usually freshly-synced Linear sub-issues whose
                // SMM hasn't dropped the actual deliverable into the
                // calendar yet — Kasper has nothing to actually review.
                const hasAsset = String(raw.asset_url || '').trim() !== '';
                const hasThumb = String(raw.thumbnail_url || '').trim() !== '';
                /* WHICH waiting component needs a file, and does it have one?
                 *
                 * Owner report 2026-09-03: four cards sat in the "waiting on a
                 * file, not on you" notice, and three of them were waiting on
                 * the CAPTION with the caption already written -- one of them a
                 * caption-only card whose video and thumbnail are both N/A.
                 * Nothing was missing; there was nothing to add. The notice told
                 * the SMM to attach a file for work that needs no file, and
                 * Kasper could not approve a caption that was sitting there
                 * finished.
                 *
                 * The old gate asked one question about the whole card -- does
                 * it carry ANY media -- and a caption cannot answer it. So ask
                 * it per component instead: a video needs `asset_url`, a
                 * thumbnail needs `thumbnail_url`, a caption needs `caption` or
                 * `caption_alt`, and a title needs `name`. Each component is
                 * asked for the thing it is actually reviewed by; none of them
                 * is exempt from being asked.
                 *
                 * `_kasperRenderCard` was already built for this. It falls back
                 * to a placeholder when there is no thumbnail, disables the
                 * watch button when there is no video, and its own comment says
                 * the single-panel hero layout "applies to video, thumbnail, and
                 * caption alike". Only this gate upstream was hiding the card. */
                const kasperComps = _calComponentsFor(raw).filter(c => _calCompKasperVisible(raw, c));
                const anyReviewable = kasperComps.some(c => _kasperCompReviewable(raw, c));
                if (hasKasperWork && !anyReviewable) {
                    // Flip-day tester finding E, corrected. The card the tester
                    // drove to Kasper Approval never appeared, and the queue was
                    // read as blind to natively-created cards. It is not: the
                    // Supabase-first read above covers every client, and native
                    // cards WITH media do render. This gate dropped it, silently,
                    // because both media columns were empty.
                    //
                    // Pre-flip that silence was nearly harmless: a media-less card
                    // at Kasper Approval was a freshly-synced Linear stub nobody
                    // had handed over on purpose. Post-flip the Production tab
                    // moves status without touching media, so an ordinary status
                    // change now strands a card in a state where the SMM believes
                    // it is with Kasper and Kasper is never told it exists.
                    //
                    // The card still stays OUT of the review list -- there is
                    // genuinely nothing to review, and the card UI is built around
                    // media -- but it is now REPORTED instead of discarded.
                    stranded.push({
                        id: String(raw.id || ''),
                        client,
                        slug,
                        name: String(raw.name || 'Untitled post'),
                        native: !!(raw.video_deliverable_id || raw.graphic_deliverable_id),
                    });
                }
                if (hasKasperWork && anyReviewable) {
                    queue.push({
                        post: raw, client, slug, smm: null,
                        _expanded: false,
                        _saving:   { video: false, graphic: false, caption: false },
                        _drafts:   { video: '',    graphic: '',    caption: '' },
                        _errors:   { video: null,  graphic: null,  caption: null },
                    });
                }
                const approvedAt = String(raw.kasper_approved_at || '').trim();
                if (approvedAt) {
                    history.push(_kasperHistoryEntryFromPost(raw, client, slug, approvedAt));
                }
                // Replies inbox: any card (incl. already-approved/posted) with
                // an unread reply on one of Kasper's internal threads. Not gated
                // by the queue's media/status rules — it's a conversation inbox.
                if (_kasperHasUnreadReply(raw)) {
                    replies.push({ post: raw, client, slug, smm: null, _replyDraft: '' });
                }
            }
            return { queue, history, replies, stranded };
        };
        const fetchOne = async (client) => {
            const slug = wlNormalizeClient(client);
            if (!forceRefresh) {
                const cached = _kasperCalCacheRead(slug);
                if (cached && cached.ok) return extract(client, cached);
            }
            const resp = await fetch(CALENDAR_GET_URL + '?client=' + encodeURIComponent(slug) + '&_t=' + Date.now());
            if (!resp.ok) throw new Error('Bad response for ' + client);
            const json = await resp.json();
            /* item 86, the queue half. This used to cache whatever came back and
               return an empty queue for a not-ok answer, so a client whose
               webhook read failed looked exactly like a client with no work --
               the worst possible failure mode for a review queue, and invisible.
               A zero-row answer now THROWS into the rejection path, which the
               caller counts and reports; only a non-empty truth is cached. */
            if (!json || !json.ok || !Array.isArray(json.posts)) throw new Error('calendar_get_unusable_payload for ' + client);
            if (!json.posts.length) throw new Error('calendar_get_zero_posts for ' + client);
            _kasperCalCacheWrite(slug, json);
            return extract(client, json);
        };
        // Fast path: ONE batched webhook call covers every client needing a
        // network read (two Google API calls server-side) instead of a
        // calendar-get round trip per client. The 5-min cache is honoured
        // exactly as before, and any batch failure falls back to the
        // per-client fan-out below — the batch is purely an upgrade.
        const settled = [];
        let remaining = WL_CLIENT_NAMES.slice();
        if (!forceRefresh) {
            remaining = [];
            for (const client of WL_CLIENT_NAMES) {
                const cached = _kasperCalCacheRead(wlNormalizeClient(client));
                if (cached && cached.ok) settled.push({ status: 'fulfilled', value: extract(client, cached) });
                else remaining.push(client);
            }
        }
        // v2: every client lives in ONE Supabase table, so ONE paginated REST
        // read covers all of them — no per-client calendar-get fan-out, no n8n
        // load. Group rows by their client column and reuse the same extract()
        // the Sheet path uses. On ANY Supabase error we leave `remaining`
        // untouched and fall through to the kasper-queue batch + per-client
        // fan-out below, so the queue can never blank. Gated on _calV2Ready() so
        // v1 is byte-identical. _calSupabaseFetchAllRows pages past PostgREST's
        // 1000-row max-rows cap, so the queue stays complete as the table grows
        // (the unpaginated single read silently dropped every row past 1000,
        // hiding freshly-added cards from Kasper once the table crossed 1000).
        if (remaining.length && _calV2Ready()) {
            try {
                const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
                let allRows;
                try {
                    allRows = await _calSupabaseFetchAllRows(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=*&or=(status.is.null,status.neq.Archived)', ctrl ? ctrl.signal : undefined);
                } finally { if (timer) clearTimeout(timer); }
                if (!Array.isArray(allRows)) throw new Error('Supabase: unexpected payload');
                const byClient = new Map();
                for (const r of allRows) {
                    const c = String((r && r.client) || '');
                    if (!c) continue;
                    if (!byClient.has(c)) byClient.set(c, []);
                    byClient.get(c).push(r);
                }
                const covered = [];
                for (const client of remaining) {
                    const shaped = { ok: true, posts: byClient.get(wlNormalizeClient(client)) || [] };
                    _kasperCalCacheWrite(wlNormalizeClient(client), shaped);
                    settled.push({ status: 'fulfilled', value: extract(client, shaped) });
                    covered.push(client);
                }
                remaining = remaining.filter(c => !covered.includes(c));
            } catch (e) {
                console.warn('[Kasper] Supabase read failed — falling back to kasper-queue/calendar-get', e);
            }
        }
        if (remaining.length) {
            try {
                const slugByClient = new Map(remaining.map(c => [c, wlNormalizeClient(c)]));
                const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
                const resp = await fetch(KASPER_QUEUE_URL, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slugs: [...slugByClient.values()] }),
                    signal: ctrl ? ctrl.signal : undefined,
                });
                if (timer) clearTimeout(timer);
                const json = await resp.json();
                if (!resp.ok || !json || !json.ok || !json.clients) throw new Error('kasper-queue not ok');
                const missing = new Set(Array.isArray(json.missing) ? json.missing : []);
                const covered = [];
                for (const [client, slug] of slugByClient) {
                    const entry = json.clients[slug];
                    // A slug in `missing` has no Calendar tab — same outcome
                    // as the fan-out's empty read, so treat it as covered.
                    const shaped = (entry && Array.isArray(entry.posts))
                        ? { ok: true, posts: entry.posts }
                        : (missing.has(slug) ? { ok: true, posts: [] } : null);
                    if (!shaped) continue;
                    _kasperCalCacheWrite(slug, shaped);
                    settled.push({ status: 'fulfilled', value: extract(client, shaped) });
                    covered.push(client);
                }
                remaining = remaining.filter(c => !covered.includes(c));
            } catch (e) {
                console.warn('[Kasper] batch queue fetch failed — falling back to per-client loads', e);
            }
        }
        // Per-client fan-out for whatever the batch didn't cover
        // (everything, when the batch endpoint is down).
        const pending = remaining;
        const worker = async () => {
            while (pending.length) {
                const client = pending.shift();
                try { settled.push({ status: 'fulfilled', value: await fetchOne(client) }); }
                catch (reason) {
                    // item 86: name the client. An anonymous rejection was
                    // dropped by the aggregator below without a word, so a
                    // client whose read failed was indistinguishable from a
                    // client with no work -- in a review queue, that is the
                    // worst way to fail.
                    console.warn('[Kasper] client load failed:', client, reason);
                    settled.push({ status: 'rejected', reason, client });
                }
            }
        };
        const workerCount = Math.min(KASPER_CAL_CONCURRENCY, pending.length);
        if (workerCount > 0) await Promise.all(Array.from({ length: workerCount }, worker));
        const queueOut = [];
        const historyOut = [];
        const repliesOut = [];
        const queueIds = new Set();
        const repliesIds = new Set();
        const strandedOut = [];
        const strandedIds = new Set();
        const unloadedOut = [];
        for (const s of settled) {
            if (s.status === 'rejected' && s.client && !unloadedOut.includes(s.client)) unloadedOut.push(s.client);
            if (s.status === 'fulfilled' && s.value) {
                for (const it of s.value.queue) {
                    if (queueIds.has(it.post.id)) continue;
                    queueIds.add(it.post.id);
                    queueOut.push(it);
                }
                historyOut.push(...s.value.history);
                for (const it of (s.value.replies || [])) {
                    if (repliesIds.has(it.post.id)) continue;
                    repliesIds.add(it.post.id);
                    repliesOut.push(it);
                }
                for (const it of (s.value.stranded || [])) {
                    if (!it || !it.id || strandedIds.has(it.id)) continue;
                    strandedIds.add(it.id);
                    strandedOut.push(it);
                }
            }
        }
        return { queue: queueOut, history: historyOut, replies: repliesOut, stranded: strandedOut, unloaded: unloadedOut };
    }

    function _kasperHistoryEntryFromPost(post, client, slug, approvedAt) {
        return {
            id: post.id,
            client, slug,
            name: post.name || 'Untitled post',
            asset_url: String(post.asset_url || ''),
            thumbnail_url: String(post.thumbnail_url || ''),
            scheduled_date: String(post.scheduled_date || ''),
            approvedAt,
        };
    }

    function _kasperLoadHistoryLog() {
        try {
            const raw = localStorage.getItem(KASPER_HISTORY_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter(x => x && x.id && x.approvedAt) : [];
        } catch { return []; }
    }
    function _kasperSaveHistoryLog(list) {
        try { localStorage.setItem(KASPER_HISTORY_KEY, JSON.stringify(list.slice(0, KASPER_HISTORY_CAP))); } catch {}
    }
    function _kasperRecordHistory(entry) {
        const log = _kasperLoadHistoryLog().filter(x => x.id !== entry.id);
        log.unshift(entry);
        _kasperSaveHistoryLog(log);
    }
    function _kasperMergeHistory(serverList, localList) {
        // Server wins when the same id appears in both (its approvedAt is
        // authoritative once the sheet has the column populated).
        const seen = new Set();
        const merged = [];
        for (const e of (serverList || [])) {
            if (!e || !e.id || seen.has(e.id)) continue;
            seen.add(e.id);
            merged.push(e);
        }
        for (const e of (localList || [])) {
            if (!e || !e.id || seen.has(e.id)) continue;
            seen.add(e.id);
            merged.push(e);
        }
        // Latest first.
        merged.sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')));
        return merged;
    }

    /* Split the queue into two buckets:
         • Waiting — at least one component is still at Kasper Approval
           (Kasper needs to make a call).
         • Tweaks pending — no component at Kasper Approval, but at
           least one component sits at Tweaks Needed with an unresolved
           Kasper tweak (Kasper has already commented; ball is in the
           SMM's court, but he might want to add follow-up tweaks before
           hitting Done reviewing).
       The count chip at the top reflects only the Waiting bucket — that's
       what "needs your attention right now" means. */
    /* ── Is a card "finished" / "closed" right now? ──────────────────────
       Both are GLOBAL + cross-device: the durable signal is a persisted
       timestamp ON THE CARD — `kasper_finished_at` / `kasper_closed_at` — that
       rides the upsert echo + Supabase realtime to every device, exactly like
       `kasper_approved_at`. The per-browser `_kasperState.dismissed` / `.closed`
       flags are kept only as a SAME-DEVICE continuity fallback. The backend
       columns and allowlist are deployed; the current contract is recorded in
       docs/features/KASPER_REVIEW_GLOBAL_ROLLOUT.md. */
    /* "Finish reviewing" hand-off. A finished card sits in "Tweaks pending"
       until a genuine fresh ask supersedes it:
         • an ACTIONABLE component is back at Kasper Approval — gated by
           _kasperUndecidedComps, so a component he cannot act on does NOT
           count: an unlinked-thumbnail graphic, or a video or thumbnail whose
           file never arrived. This is the SAME set the Finish gate reads, and
           it has to be: any daylight between them is a card that can be
           finished and never reads as finished; or
         • a message landed after he finished (the SMM replied / client commented).
       `kasper_finished_at` doubles as his "seen up to here" stamp, so the second
       test is just latestMsg > kasper_finished_at. */
    /* X-close (top-right X) — no decision, just hide it. Re-surfaces when a new
       message arrives after the close (a fresh "look again"). Pre-backend it
       falls back to the local flag + the queue-membership prune (today's rule). */
    function _kasperIsClosed(post) {
        if (!post) return false;
        const closedAt = String((post && post.kasper_closed_at) || '');
        const localClosed = !!(_kasperState.closed && _kasperState.closed[post.id]);
        if (!closedAt && !localClosed) return false;
        if (closedAt) {
            const latest = _calLatestMsgCreatedAt(post);                 // created-at: a resolve bump must not un-hide a closed card
            if (latest && latest > closedAt) return false;
        }
        return true;
    }
    /* When a card was SENT TO KASPER. The stored record of that moment is
       calendar_post_events: every write path logs a status_change row with
       to_status 'Kasper Approval' per component (video, graphic, caption,
       title). video_status_at / graphic_status_at only cover two of the four
       parts, so they are the fallback, not the source. Per component we take
       its LATEST entry (a return to Kasper is a fresh ask), and per card the
       OLDEST of those among the parts still waiting on him -- the part that
       has waited longest is how long the card has waited. */
    const _KASPER_PARTS = ['video', 'graphic', 'caption', 'title'];
    async function _kasperFetchSentEvents(items) {
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY || !items.length) return [];
        const ids = [...new Set(items.map(it => String(it.post.id)))];
        return _kedRestIn('calendar_post_events',
            'post_id,component,ts&action=eq.status_change&to_status=eq.' + encodeURIComponent('Kasper Approval'),
            'post_id', ids);
    }
    function _kasperSentAtMs(post, eventsByPost) {
        const waitingParts = _KASPER_PARTS.filter(c => String(post[c + '_status'] || '') === 'Kasper Approval');
        const latest = new Map();
        for (const e of (eventsByPost.get(String(post.id)) || [])) {
            const t = Date.parse(e.ts || '');
            if (!isFinite(t)) continue;
            const c = e.component || '';
            if (!latest.has(c) || latest.get(c) < t) latest.set(c, t);
        }
        let best = Infinity;
        for (const c of waitingParts) {
            let t = latest.get(c);
            if (t == null && (c === 'video' || c === 'graphic')) t = Date.parse(post[c + '_status_at'] || '');
            if (isFinite(t) && t < best) best = t;
        }
        // A card-level (component-less) entry only counts when no part had one.
        if (best === Infinity && latest.has('')) best = latest.get('');
        return best;
    }
    function _kasperSortBySentAt(items, events) {
        const byPost = new Map();
        for (const e of (events || [])) {
            const k = String(e.post_id);
            if (!byPost.has(k)) byPost.set(k, []);
            byPost.get(k).push(e);
        }
        for (const it of items) it.sentAtMs = _kasperSentAtMs(it.post, byPost);
        // Oldest first; unknown times last, then scheduled date, then client.
        items.sort((a, b) => {
            if (a.sentAtMs !== b.sentAtMs) return a.sentAtMs < b.sentAtMs ? -1 : 1;
            const da = String(a.post.scheduled_date || '').slice(0,10);
            const db = String(b.post.scheduled_date || '').slice(0,10);
            if (da && db && da !== db) return da < db ? -1 : 1;
            if (da && !db) return -1;
            if (!da && db) return 1;
            return String(a.client).localeCompare(String(b.client));
        });
        return items;
    }


    /* Samples in the Review queue (owner request 2026-09-26). Sample cards
       are listed beside calendar cards in the same sections, but each one is
       still rendered, decided and saved by the Samples code: the card comes
       from _sxrKasperRenderCard, its buttons call the _sxrKasper* handlers,
       and its data stays in _sxrKasperState. Only the listing lives here. */
    // Stable merge: calendar order is kept as sorted, each sample slots in
    // before the first calendar card handed over later than it.
    function _kasperMergeBySentAt(calItems, sxrItems) {
        if (!sxrItems.length) return calItems;
        const out = []; let j = 0;
        for (const it of calItems) {
            const t = isFinite(it.sentAtMs) ? it.sentAtMs : Infinity;
            while (j < sxrItems.length && sxrItems[j].sentAtMs < t) out.push(sxrItems[j++]);
            out.push(it);
        }
        while (j < sxrItems.length) out.push(sxrItems[j++]);
        return out;
    }
    function _kasperRenderAnyCard(it) {
        return it && it._sxr ? _sxrKasperRenderCard(it) : _kasperRenderCard(it);
    }
    // A samples repaint must not wipe a calendar load failure: keep saying
    // the calendar cards are missing, with a retry, above whatever loaded.
    function _kasperRenderQueueErrorNotice() {
        if (!_kasperState.error) return '';
        return `<div class="kasper-unloaded" data-kasper-queue-error="1">
            <div class="kasper-stranded-title">Couldn't load the queue</div>
            <div class="kasper-stranded-sub">Calendar cards are missing from the list below, not absent: ${_calEsc(_kasperState.error)} <button class="cal-link" type="button" onclick="_kasperLoadReview(true)">Try again</button></div>
        </div>`;
    }
    function _kasperRenderSampleNotice() {
        if (!_kasperSamplesMerged() || !_sxrKasperState.error) return '';
        return `<div class="kasper-unloaded" data-kasper-samples-unloaded="1">
            <div class="kasper-stranded-title">Samples didn't load</div>
            <div class="kasper-stranded-sub">Samples waiting for you are missing from the list below, not absent. <button class="cal-link" type="button" onclick="_sxrKasperLoadQueue(true)">Try again</button></div>
        </div>`;
    }
    function _kasperRenderSampleHistory() {
        if (!_kasperSamplesMerged() || typeof _sxrKasperRenderHistorySection !== 'function') return '';
        return _sxrKasperRenderHistorySection('Approved samples');
    }

    let _kasperPaintRetry = null;
    function _kasperPaintReviewNow() {
        const body = document.getElementById('kasperReviewBody');
        const count = document.getElementById('kasperReviewCount');
        if (!body) return;
        // Never wipe a textarea Kasper is typing in. EVERY caller (realtime echo,
        // reload, post-save) defers here until focus leaves — the data is already
        // in _kasperState, so a short re-arm catches up the moment he blurs. This
        // is the central guard; per-caller guards elsewhere are belt-and-braces.
        const _ae = document.activeElement;
        if (_ae && _ae.tagName === 'TEXTAREA' && _ae.closest && _ae.closest('#kasperContent')) {
            if (_kasperPaintRetry) clearTimeout(_kasperPaintRetry);
            _kasperPaintRetry = setTimeout(_kasperPaintReview, 1200);
            return;
        }
        // Don't rebuild the list out from under a pressed button — the click
        // would land on a removed node and be lost (see _kasperPointerHeld).
        // Short re-arm; _kasperReleasePointer also flushes on pointerup.
        if (_kasperPointerHeld) {
            if (_kasperPaintRetry) clearTimeout(_kasperPaintRetry);
            _kasperPaintRetry = setTimeout(_kasperPaintReview, 200);
            return;
        }
        if (_kasperPaintRetry) { clearTimeout(_kasperPaintRetry); _kasperPaintRetry = null; }
        const _cal = _kasperPartitionItems(_kasperState.items);
        const _sxr = _kasperSamplePartition();
        const urgent = _kasperMergeBySentAt(_cal.urgent, _sxr.urgent);
        const waiting = _kasperMergeBySentAt(_cal.waiting, _sxr.waiting);
        const tweaks = _kasperMergeBySentAt(_cal.tweaks, _sxr.tweaks);
        // Both counters cover urgent + waiting: the ping changes where a card
        // SITS, never whether it is still his to do.
        const openCount = urgent.length + waiting.length;
        if (count) count.textContent = String(openCount);
        const tabCount = document.querySelector('[data-kasper-count="review"]');
        if (tabCount) tabCount.textContent = String(openCount);
        // Waiting section uses the same collapsible-style head as Tweaks
        // pending and Approved history so the three buckets feel like
        // siblings rather than "the main queue plus two add-ons". Waiting
        // defaults to open since it's where Kasper actually works.
        const waitingCollapsedCls = _kasperState.waitingCollapsed ? ' collapsed' : '';
        const waitingBodyHtml = waiting.length
            ? `<div class="kasper-list">${waiting.map(_kasperRenderAnyCard).join('')}</div>`
            : `<div class="kasper-empty">
                <div class="kasper-empty-icon"><svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5L6.5 12L13 4.5"/></svg></div>
                <div class="kasper-empty-title">You're all caught up</div>
                <div class="kasper-empty-sub">Nothing is waiting for your review right now.</div>
            </div>`;
        const waitingHtml = `<div class="kasper-history-wrap kasper-waiting-wrap${waitingCollapsedCls}" id="kasperWaitingWrap">
            <div class="kasper-history-head" onclick="_kasperToggleWaiting()">
                <span class="kasper-history-title">Waiting for your review</span>
                <span class="kasper-history-count">${waiting.length}</span>
                <svg class="kasper-history-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg>
            </div>
            <div class="kasper-history-body">${waitingBodyHtml}</div>
        </div>`;
        const _thumbs = _kcardHarvestThumbs(body, 'data-kasper-pid');
        // The queue has content on screen: the held analytics extras may start.
        // Only once the queue has actually loaded -- the SMM sheet can land
        // first and repaint an empty body, which is not content.
        if (_kasperState.lastLoaded && typeof _analyticsReleaseExtras === 'function') _analyticsReleaseExtras();
        body.innerHTML = _kasperRenderUnloadedNotice() + _kasperRenderStrandedNotice() + _kasperRenderQueueErrorNotice() + _kasperRenderSampleNotice() + _kasperRenderUrgentSection(urgent) + waitingHtml + _kasperRenderTweaksSection(tweaks) + _kasperRenderHistorySection() + _kasperRenderSampleHistory();
        _kcardRestoreThumbs(body, _thumbs, 'data-kasper-pid');
    }

    /* Clients whose calendar could not be read on this load. Without this the
       queue simply renders without them, which is indistinguishable from those
       clients having no work -- the failure mode item 86 was filed for. Renders
       nothing when every client loaded. */
    function _kasperRenderUnloadedNotice() {
        const list = Array.isArray(_kasperState.unloaded) ? _kasperState.unloaded : [];
        if (!list.length) return '';
        const names = list.slice(0, 8).map(n => _calEsc(n)).join(', ');
        const more = list.length > 8 ? ` and ${list.length - 8} more` : '';
        const verb = list.length === 1 ? 'client could not be loaded' : 'clients could not be loaded';
        return `<div class="kasper-unloaded" data-kasper-unloaded="${list.length}">
            <div class="kasper-stranded-title">${list.length} ${verb}</div>
            <div class="kasper-stranded-sub">Any cards these clients have are missing from the queue below, not absent: ${names}${more}. Refresh to try again.</div>
        </div>`;
    }

    /* Cards sitting at Kasper Approval where not one waiting component has the
       thing it is reviewed by -- no video file, no thumbnail, no caption text,
       no title text. They are not review work, so they stay out of the list --
       but the SMM has handed them over and believes Kasper has them, so staff
       have to be told the content never arrived. Before this, the queue discarded
       them without a word, which is how the flip-day tester read an empty queue
       as "Kasper cannot see natively-created cards at all". Renders nothing
       when the bucket is empty, so a healthy day is unchanged.

       The copy says CONTENT, not "a file", deliberately: an empty caption or
       title lands here too, and telling the SMM to attach a file for a caption
       is the exact wrong instruction the 2026-09-03 owner report was about. */
    /* The stranded notice is for STAFF looking at Kasper's tab (admin or SMM),
       who can chase the missing content -- not for Kasper, who can do nothing
       about it. The verified staff identity is the only viewer information the
       page holds. Kasper signs in with the admin role like the other admin, so
       role alone cannot tell them apart; his verified member name is the one
       thing that does. No verified identity means no notice (fail closed). */
    function _kasperStrandedViewerIsStaff() {
        const identity = typeof _syncviewStaffIdentityForHeaders === 'function' ? _syncviewStaffIdentityForHeaders() : null;
        if (!identity) return false;
        const role = String(identity.role || '').trim().toLowerCase();
        if (role !== 'admin' && role !== 'smm') return false;
        const first = String(identity.member && identity.member.name || '').trim().split(/\s+/)[0].toLowerCase();
        return first !== 'kasper';
    }
    function _kasperRenderStrandedNotice() {
        if (!_kasperStrandedViewerIsStaff()) return '';
        const list = Array.isArray(_kasperState.stranded) ? _kasperState.stranded : [];
        if (!list.length) return '';
        const rows = list.slice(0, 12).map(it => `<li><strong>${_calEsc(it.client)}</strong> · ${_calEsc(it.name)}</li>`).join('');
        const more = list.length > 12 ? `<li>and ${list.length - 12} more</li>` : '';
        const noun = list.length === 1 ? 'card is' : 'cards are';
        const pron = list.length === 1 ? 'it' : 'them';
        return `<div class="kasper-stranded" data-kasper-stranded="${list.length}">
            <div class="kasper-stranded-title">${list.length} ${noun} with Kasper but missing content</div>
            <div class="kasper-stranded-sub">Every part sent to Kasper is empty: a video or thumbnail that was never attached, or a caption or title that was never written. Kasper has nothing to review and does not see ${pron} in his queue. As soon as any part gets its content, the card joins his queue on its own.</div>
            <ul class="kasper-stranded-list">${rows}${more}</ul>
        </div>`;
    }

    /* Cards somebody has explicitly pinged Kasper about — the ones that could
       not wait for his next pass. Sits ABOVE "Waiting for your review" because
       that is the entire point of it, and is otherwise the same section as its
       three siblings: same collapsible chrome, same _kasperRenderCard, same
       actions. A card leaves on its own the moment the ping stops being live
       (he decides the component, or it leaves Kasper Approval) — see
       _calKasperUrgentActive — so nothing has to be cleared by hand.

       Hidden entirely when empty, like Tweaks pending: a permanent empty
       "Urgent" header would train him to ignore the one thing it exists to
       make unignorable. */
    /* Keyboard + AT semantics for a collapsible section head. The heads are
       styled `div`s, so without this they are mouse-only: not focusable, not
       announced as controls, and with no way to report collapsed state. New
       visible UI has to carry keyboard, focus and ARIA as part of the feature
       (AGENTS.md; docs/features/UI_DESIGN_STANDARDS.md), so the Urgent heads
       below take these attributes and _svSectionHeadKey handles Enter/Space.

       Emitted as attributes rather than by swapping the element for a <button>
       on purpose: the three sibling heads (Waiting / Tweaks pending / Approved
       history) share `.kasper-history-head`'s styling, and a <button> there
       would need its own reset to keep the four identical. Those three still
       lack this and are unchanged here -- widening an urgent-ping PR into them
       is a separate change. (Codex P2 on PR 1370.) */
    function _svSectionHeadA11y(expanded) {
        return ` role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}" onkeydown="_svSectionHeadKey(event)"`;
    }
    function _svSectionHeadKey(ev) {
        if (!ev || (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar')) return;
        ev.preventDefault();                       // Space must not scroll the queue
        if (ev.currentTarget && ev.currentTarget.click) ev.currentTarget.click();
    }
    window._svSectionHeadKey = _svSectionHeadKey;
    function _kasperRenderUrgentSection(urgent) {
        if (!urgent.length) return '';
        const collapsedCls = _kasperState.urgentCollapsed ? ' collapsed' : '';
        const cards = urgent.map(_kasperRenderAnyCard).join('');
        return `<div class="kasper-history-wrap kasper-urgent-wrap${collapsedCls}" id="kasperUrgentWrap">
            <div class="kasper-history-head" onclick="_kasperToggleUrgent()"${_svSectionHeadA11y(!_kasperState.urgentCollapsed)}>
                <span class="kasper-history-title">Urgent</span>
                <span class="kasper-history-count">${urgent.length}</span>
                <svg class="kasper-history-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg>
            </div>
            <div class="kasper-history-body"><div class="kasper-list">${cards}</div></div>
        </div>`;
    }
    function _kasperToggleUrgent() {
        _kasperState.urgentCollapsed = !_kasperState.urgentCollapsed;
        const wrap = document.getElementById('kasperUrgentWrap');
        if (wrap) {
            wrap.classList.toggle('collapsed', _kasperState.urgentCollapsed);
            // A stale aria-expanded is worse than none: it tells a screen reader
            // the section is open while it is collapsed.
            const head = wrap.querySelector('.kasper-history-head');
            if (head) head.setAttribute('aria-expanded', _kasperState.urgentCollapsed ? 'false' : 'true');
        }
    }
    window._kasperToggleUrgent = _kasperToggleUrgent;

    /* Cards Kasper has already tweaked but hasn't hit Done reviewing on
       yet. Shares the same collapsible chrome as the Approved history
       section. Hidden entirely when the bucket is empty so the page
       doesn't carry empty headers. */
    function _kasperRenderTweaksSection(tweaks) {
        if (!tweaks.length) return '';
        const collapsedCls = _kasperState.tweaksCollapsed ? ' collapsed' : '';
        const cards = tweaks.map(_kasperRenderAnyCard).join('');
        return `<div class="kasper-history-wrap${collapsedCls}" id="kasperTweaksWrap">
            <div class="kasper-history-head" onclick="_kasperToggleTweaks()">
                <span class="kasper-history-title">Tweaks pending</span>
                <span class="kasper-history-count">${tweaks.length}</span>
                <svg class="kasper-history-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg>
            </div>
            <div class="kasper-history-body"><div class="kasper-list">${cards}</div></div>
        </div>`;
    }

    function _kasperToggleTweaks() {
        _kasperState.tweaksCollapsed = !_kasperState.tweaksCollapsed;
        const wrap = document.getElementById('kasperTweaksWrap');
        if (wrap) wrap.classList.toggle('collapsed', _kasperState.tweaksCollapsed);
    }
    window._kasperToggleTweaks = _kasperToggleTweaks;
    function _kasperToggleWaiting() {
        _kasperState.waitingCollapsed = !_kasperState.waitingCollapsed;
        const wrap = document.getElementById('kasperWaitingWrap');
        if (wrap) wrap.classList.toggle('collapsed', _kasperState.waitingCollapsed);
    }
    window._kasperToggleWaiting = _kasperToggleWaiting;

    function _kasperHistoryDayKey(iso) {
        const t = Date.parse(iso || '');
        if (!isFinite(t)) return '';
        const d = new Date(t);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function _kasperHistoryDayLabel(key) {
        if (!key) return 'Earlier';
        const today = _kasperHistoryDayKey(new Date().toISOString());
        const yest = new Date(); yest.setDate(yest.getDate() - 1);
        const yKey = _kasperHistoryDayKey(yest.toISOString());
        if (key === today) return 'Today';
        if (key === yKey) return 'Yesterday';
        const [y, m, d] = key.split('-').map(Number);
        const dt = new Date(y, (m || 1) - 1, d || 1);
        return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }

    function _kasperRenderHistorySection() {
        const list = _kasperState.history || [];
        if (!list.length) return '';
        const groups = new Map();
        for (const e of list) {
            const key = _kasperHistoryDayKey(e.approvedAt);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(e);
        }
        const dayKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a));
        const daysHtml = dayKeys.map(k => {
            const rows = groups.get(k).map(e => {
                const thumb = e.thumbnail_url || e.asset_url || '';
                const thumbHtml = thumb
                    ? `<img loading="lazy" src="${_calEscAttr(thumb)}" alt="" onerror="this.replaceWith(_kasperHistoryThumbFallback())">`
                    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 11l3 3 5-5"/></svg>`;
                const calUrl = svRoute.clean(`/#calendar/${encodeURIComponent(e.slug)}/${encodeURIComponent(e.id)}`);
                const videoBtn = e.asset_url
                    ? `<a href="${_calEscAttr(e.asset_url)}" target="_blank" rel="noopener">Video</a>`
                    : '';
                const t = Date.parse(e.approvedAt);
                const timeStr = isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                return `<div class="kasper-history-row">
                    <div class="kasper-history-thumb">${thumbHtml}</div>
                    <div class="kasper-history-main">
                        <div class="kasper-history-line1">${_calEsc(e.name)}</div>
                        <div class="kasper-history-line2"><span class="kasper-history-client">${_calEsc(e.client)}</span>${timeStr ? ` · approved ${_calEsc(timeStr)}` : ''}</div>
                    </div>
                    <div class="kasper-history-actions">${videoBtn}<a href="${_calEscAttr(calUrl)}" target="_blank" rel="noopener">Open</a></div>
                </div>`;
            }).join('');
            return `<div class="kasper-history-day">
                <div class="kasper-history-day-label">${_calEsc(_kasperHistoryDayLabel(k))}<span class="kasper-day-count">· ${groups.get(k).length} approved</span></div>
                ${rows}
            </div>`;
        }).join('');
        const collapsedCls = _kasperState.historyCollapsed ? ' collapsed' : '';
        return `<div class="kasper-history-wrap${collapsedCls}" id="kasperHistoryWrap">
            <div class="kasper-history-head" onclick="_kasperToggleHistory()">
                <span class="kasper-history-title">Approved history</span>
                <span class="kasper-history-count">${list.length}</span>
                <svg class="kasper-history-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg>
            </div>
            <div class="kasper-history-body">${daysHtml}</div>
        </div>`;
    }

    function _kasperHistoryThumbFallback() {
        const span = document.createElement('span');
        span.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 11l3 3 5-5"/></svg>`;
        return span.firstElementChild;
    }

    function _kasperToggleHistory() {
        _kasperState.historyCollapsed = !_kasperState.historyCollapsed;
        const wrap = document.getElementById('kasperHistoryWrap');
        if (wrap) wrap.classList.toggle('collapsed', _kasperState.historyCollapsed);
    }

    function _kasperFmtDateNice(iso) {
        if (!iso) return '';
        const s = String(iso).slice(0, 10);
        const d = new Date(s + 'T00:00:00');
        if (isNaN(d)) return s;
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function _kasperRenderCard(item) {
        const p   = item.post;
        const pid = p.id;
        const title = p.name || 'Untitled post';
        const dateNice = _kasperFmtDateNice(p.scheduled_date);
        const thumbInfo = _calDeriveThumbInfo(p);
        const hasThumbUrl = !!thumbInfo.url;
        const thumbHtml = hasThumbUrl
            ? _calThumbImgTag(thumbInfo, '_calOnMiniThumbError')
            : thumbInfo.frame
                ? _calMiniLinkBadgeHtml('kcard-thumb-fallback', thumbInfo.frameKind)
                : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 17l-5-5L5 21"/></svg>`;
        const zoomBtnHtml = hasThumbUrl
            ? `<button class="kcard-thumb-zoom" type="button" onclick="event.stopPropagation();_kasperOpenLightbox('${_calEscAttr(pid)}')" title="View thumbnail full screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-8 8M3 21l8-8"/></svg></button>`
            : thumbInfo.frame
                ? `<a class="kcard-thumb-zoom" href="${_calEscAttr(thumbInfo.frame)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" title="${_calEscAttr(_calOpenCardMeta(thumbInfo.frameKind).title)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3"/><path d="M9.5 2.5H13.5V6.5"/><path d="M13.5 2.5L7.5 8.5"/></svg></a>`
                : '';
        const videoUrl = String(p.asset_url || '').trim();
        // SMM row — Slack link removed 2026-08-20; see the samples twin above.
        const smm = item.smm;
        const smmHtml = smm && smm.name
            ? `<span class="kcard-smm" onclick="event.stopPropagation();"><span class="kcard-smm-avatar">${_calEsc(smm.name.charAt(0).toUpperCase())}</span>${_calEsc(smm.name)}</span>`
            : '';
        const watchBtn = videoUrl
            ? `<a class="kcard-watch-btn" href="${_calEscAttr(videoUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>Watch video</a>`
            : `<span class="kcard-watch-btn is-disabled" title="No video URL on this card"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>No video URL</span>`;
        // "Finish reviewing" — Kasper's explicit "I'm done with this card"
        // exit. Always shown, but enabled only once EVERY component has had an
        // explicit action (approve / request change / comment). There is no
        // implicit approval, so the end state can't depend on click order.
        // Clicking it changes no status (each component already carries its
        // decision): all-approved → logged Approved; any change request →
        // handed to the SMM; any open comment → waiting on the SMM's reply.
        const undecidedComps = _kasperUndecidedComps(p);
        const canFinish = undecidedComps.length === 0;
        const isFinished = _kasperIsFinished(p);
        const finishTitle = canFinish
            ? 'Finish reviewing — hand this card to the SMM. Approved components go to the client; change requests move to "Tweaks pending"; anything you only commented on waits for their reply. Nothing is approved unless you approved it.'
            : 'Decide on the ' + undecidedComps.map(c => COMP_LABELS[c]).join(' & ') + ' first — approve it or request a change to finish. (A comment is just a question; it doesn\'t count as a decision.)';
        // While Kasper is still reviewing (not finished) he gets the Finish
        // action; once finished the card sits in "Tweaks pending", so show its
        // handed-off state instead (it returns to Waiting if the SMM replies or
        // sends a component back to Kasper Approval).
        const doneBtn = isFinished
            ? `<button type="button" class="kcard-done-btn" disabled title="Finished — these tweaks are with the SMM. This card returns to your queue if they reply or send a component back to you."><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5L6.5 12L13 4.5"/></svg>Sent to SMM</button>`
            : `<button type="button" class="kcard-done-btn" ${canFinish ? '' : 'disabled'} onclick="event.stopPropagation();_kasperDismiss('${_calEscAttr(pid)}')" title="${_calEscAttr(finishTitle)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5L6.5 12L13 4.5"/></svg>Finish reviewing</button>`;
        // URGENT ping — the same affordance as the SMM's calendar button, surfaced
        // in Kasper's queue so he can flag a video tweak straight to the editor in
        // Slack (#video-editing) himself instead of waiting on the SMM to click it.
        // Same gate as the calendar (_calShowUrgent): video at Tweaks Needed with a
        // linked sub-issue to resolve the editor from. Routes through
        // _kasperSendUrgentSlack, which resolves the post from the (cross-client)
        // review queue rather than calState.posts.
        const urgentBtn = _calShowUrgent(p, 'video')
            ? _calUrgentButtonHtml(_calEscAttr(pid), '_kasperSendUrgentSlack', p, 'kcard-urgent-btn', true)
            : '';
        const calUrl = svRoute.clean(`/#calendar/${encodeURIComponent(item.slug)}/${encodeURIComponent(pid)}`);
        const openTweaks = _kasperOpenTweakCount(p);
        const tweaksChip = openTweaks > 0
            ? `<span class="kcard-tweaks-chip" title="${openTweaks} open tweak${openTweaks === 1 ? '' : 's'}"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3 2.5V12H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/></svg>${openTweaks}</span>`
            : '';
        const aatChip = _calComponentsFor(p).some(c => _calShowApprovedAfterTweaks(p, c))
            ? `<span class="kcard-aat-chip" title="No more tweaks needed — pre-cleared for the client"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg></span>`
            : '';
        const dateHtml = dateNice
            ? `<span class="kcard-date"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>${_calEsc(dateNice)}</span>`
            : `<span class="kcard-date is-empty">No date</span>`;
        const expandedHtml = item._expanded ? _kasperRenderExpanded(item) : '';
        return `<div class="kcard${item._expanded ? ' expanded' : ''}" data-kasper-pid="${_calEscAttr(pid)}">
            <button class="kcard-close-btn" type="button" onclick="event.stopPropagation();_kasperClose('${_calEscAttr(pid)}')" title="Hide this card. It comes back if someone posts a new message on it." aria-label="Close card"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
            <div class="kcard-strip" onclick="_kasperToggleCard('${_calEscAttr(pid)}')">
                <div class="kcard-thumb${hasThumbUrl || thumbInfo.frame ? '' : ' is-no-image'}">${thumbHtml}${zoomBtnHtml}</div>
                <div class="kcard-main">
                    <div class="kcard-line1">
                        <span class="kcard-client">${_calEsc(item.client)}</span>
                        <span class="kcard-dot">·</span>
                        ${dateHtml}
                        ${tweaksChip}
                        ${aatChip}
                        ${_kasperHasUnreadReply(p) ? '<span class="kcard-newreply-chip">New message</span>' : ''}
                        ${undecidedComps.length ? `<span class="kcard-comp-pills" title="Awaiting your decision">${undecidedComps.map(c => `<span class="kcard-comp-pill">${_calEsc(COMP_LABELS[c])}</span>`).join('')}</span>` : ''}
                    </div>
                    <div class="kcard-title">${_calEsc(title)}</div>
                    <div class="kcard-meta-row">${smmHtml}</div>
                </div>
                <div class="kcard-actions" onclick="event.stopPropagation();">
                    ${urgentBtn}
                    ${doneBtn}
                    ${watchBtn}
                    <button class="kcard-expand-btn" type="button" onclick="_kasperToggleCard('${_calEscAttr(pid)}')" aria-label="${item._expanded ? 'Collapse' : 'Expand'} card"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg></button>
                </div>
            </div>
            ${expandedHtml}
        </div>`;
    }

    /* Kasper's URGENT ping. Mirrors the SMM calendar button, but the review
       queue is CROSS-CLIENT, so the post can't be looked up in calState.posts
       (that's only the actively-loaded client) — it's resolved from
       _kasperState.items / .replies instead, and the card's own client is sent.
       Everything else (confirm, latch, toast) is the shared dispatch, so the
       Slack message is identical to an SMM-triggered ping. */
    function _kasperSendUrgentSlack(event, pid) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        const btn = (event && event.currentTarget) ? event.currentTarget : null;
        if (btn && btn.dataset.urgentSent === '1') {
            showNotify('Already sent', 'An urgent ping for this video was already sent in this session.');
            return;
        }
        const item = (_kasperState.items || []).find(x => x && x.post && x.post.id === pid)
                  || (_kasperState.replies || []).find(x => x && x.post && x.post.id === pid);
        if (!item || !item.post) return;
        const issue = String(item.post.linear_issue_id || '').trim();
        if (!String(item.post.video_deliverable_id || '').trim()) {
            showNotify(URGENT_EDITOR_NEEDS_NATIVE.title, URGENT_EDITOR_NEEDS_NATIVE.text);
            return;
        }
        const client = String(item.client || wlCanonicalClient(item.slug) || '').trim();
        _calUrgentSlackDispatch(btn, issue, client, item.post.name, {
            native: String(item.post.video_deliverable_id || '').trim() ? { action: 'native_urgent_dispatch', client_slug: String(item.slug || calClientSlug(client)),
                deliverable_id: _writeUiNativeId(item.post, 'video'), card_id: String(item.post.id), surface: 'calendar', video_status_at: String(item.post.video_status_at || '') } : null,
            currentClientSlug: () => String(((_kasperState.items || []).concat(_kasperState.replies || []).find(x => x && x.post && x.post.id === pid) || {}).slug || ''),
            currentPost: () => ((_kasperState.items || []).concat(_kasperState.replies || []).find(x => x && x.post && x.post.id === pid) || {}).post,
            persist: (ping) => _calPersistUrgentSentForPost(item.slug || client, item.post, ping)
        });
    }
    window._kasperSendUrgentSlack = _kasperSendUrgentSlack;

    function _kasperRenderExpanded(item /*, comments, videoUrl, calUrl */) {
        const p = item.post;
        // Two reasons to show a panel: (1) the component is at Kasper
        // Approval — his decision is pending; (2) Kasper has at least one
        // unresolved tweak on this component — he may want to add more
        // notes, and the panel doubles as a thread view. Data-driven, so
        // it survives reloads natively without session-only flags.
        // Tightened: a stale tweak comment alone is no longer enough to
        // pin a panel open — the sub-status must still be Kasper Approval
        // OR Tweaks Needed-with-unresolved-tweak. Anything past that and
        // the panel drops out (handled by _calCompKasperVisible).
        // Which components those are, and why only the pending-decision ones
        // are content-gated, lives on _kasperPanelComps — the SAME function the
        // open-tweak chip tallies, so the badge and this card cannot disagree.
        const activeComps = _kasperPanelComps(p);
        if (!activeComps.length) {
            return `<div class="cal-review-body kasper-review-body"><div class="cal-empty" style="grid-column: 1 / -1; padding: 12px;">Nothing pending Kasper approval on this card.</div></div>`;
        }
        // Hero layout: a single pending panel gets the cinematic treatment
        // — preview on the left, action column on the right. Applies to
        // video, thumbnail, and caption alike so the visual weight stays
        // consistent regardless of which single component Kasper is
        // looking at.
        if (activeComps.length === 1) {
            return `<div class="cal-review-body kasper-review-body is-hero" onclick="event.stopPropagation();">${_kasperHeroPanel(item, activeComps[0])}</div>`;
        }
        const panels = activeComps.map(comp => _kasperPanelHtml(item, comp)).join('');
        const cols = activeComps.length;
        const gridCols = cols >= 4 ? 2 : cols;   // 4 comps (title review on) → 2×2
        return `<div class="cal-review-body kasper-review-body" style="grid-template-columns: repeat(${gridCols}, minmax(0, 1fr));" onclick="event.stopPropagation();">${panels}</div>`;
    }

    function _kasperHeroPreviewHtml(p, comp) {
        const playIco = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
        const zoomIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-8 8M3 21l8-8"/></svg>`;
        if (comp === 'video') {
            const url = String(p.asset_url || '').trim();
            const thumbUrl = _calDeriveThumb(p);
            if (!url) return `<div class="kasper-hero-poster kasper-hero-poster-empty"><span class="kasper-hero-play-label">No video yet</span></div>`;
            if (thumbUrl) {
                return `<a class="kasper-hero-poster" href="${_calEscAttr(url)}" target="_blank" rel="noopener" aria-label="Open video"><img class="kasper-hero-poster-bg" src="${_calEscAttr(thumbUrl)}" alt="" onerror="this.style.display='none'"><span class="kasper-hero-poster-overlay"><span class="kasper-hero-play">${playIco}</span><span class="kasper-hero-play-label">Open video</span></span></a>`;
            }
            return `<a class="kasper-hero-poster kasper-hero-poster-blank" href="${_calEscAttr(url)}" target="_blank" rel="noopener" aria-label="Open video"><span class="kasper-hero-poster-overlay"><span class="kasper-hero-play">${playIco}</span><span class="kasper-hero-play-label">Open video</span></span></a>`;
        }
        if (comp === 'graphic') {
            const raw = String(p.thumbnail_url || '').trim();
            if (!raw) return `<div class="kasper-hero-poster kasper-hero-poster-empty"><span class="kasper-hero-play-label">No thumbnail yet</span></div>`;
            const imgUrl = _calDeriveThumb(p);
            // Frame.io links (no public image, block embedding) and folder-of-
            // images links (a Story's frames) can't render as a real <img> and
            // the lightbox can't show them either — give Kasper the same branded
            // click-to-open card the client and calendar surfaces use so he can
            // open it in a new tab.
            if (!imgUrl) {
                const linkKind = _calIsFrameLink(raw) ? 'frame' : (_calIsFolderLink(raw) ? 'folder' : '');
                if (linkKind) {
                    const openUrl = linkKind === 'folder' ? _calFolderOpenUrl(raw) : _calFrameOpenUrl(raw);
                    return _calReviewFrameHtml(openUrl, 'hero', linkKind);
                }
            }
            const escPid = _calEscAttr(p.id);
            return `<button type="button" class="kasper-hero-poster kasper-hero-poster-graphic" onclick="_kasperOpenLightbox('${escPid}')" aria-label="Open thumbnail full screen" title="Open full size"><img class="kasper-hero-poster-fg" src="${_calEscAttr(imgUrl || raw)}" alt="" onerror="this.parentElement.classList.add('kasper-hero-poster-empty');"><span class="kasper-hero-zoom-chip" aria-hidden="true">${zoomIco}</span></button>`;
        }
        if (comp === 'title') {
            const t = String(p.name || '').trim();
            return `<div class="kasper-hero-caption-card${t ? '' : ' kasper-hero-caption-empty'}">${t ? _calEsc(t) : 'No title yet.'}</div>`;
        }
        // caption
        const cap = String(p.caption || '').trim();
        const alt = String(p.caption_alt || '').trim();
        if (!cap && !alt) return `<div class="kasper-hero-caption-card kasper-hero-caption-empty">No caption yet.</div>`;
        if (!alt) return `<div class="kasper-hero-caption-card">${_calEsc(cap)}</div>`;
        const sec = (which, text) => {
            const m = _calCapSecMeta(which, p);
            return `<div class="kasper-hero-cap-sec"><div class="kasper-hero-cap-head"><span class="cal-review-cap-ico" style="background:${m.color}">${m.ico}</span>${_calEsc(m.label)}</div><div class="kasper-hero-cap-text">${text ? _calEsc(text) : '<em>No caption yet.</em>'}</div></div>`;
        };
        return `<div class="kasper-hero-caption-card kasper-hero-caption-multi">${sec('main', cap)}${sec('alt', alt)}</div>`;
    }

    /* Render a Kasper review thread, collapsed to the most recent few with a
       Show more / Show less toggle so a long history doesn't dominate the panel.
       Expand state lives on the item, per component. */
    function _kasperRenderThread(item, comp, comments) {
        if (!comments || !comments.length) return `<div class="cal-review-comment-empty">No comments yet.</div>`;
        const resolvedIco = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L5 9.5L10 3.5"/></svg>`;
        const row = (c) => {
            const author = c.author || (c.role === 'client' ? 'Client' : c.role === 'kasper' ? 'Kasper' : 'SMM');
            const isResolved = !!c.done;
            const resolvedBadge = isResolved ? `<span class="cal-review-resolved-pill">${resolvedIco}Resolved</span>` : '';
            return `<div class="cal-review-comment cal-cm-${c.role || 'smm'}${c.parent_id ? ' is-reply' : ''}${isResolved ? ' is-resolved' : ''}">
                    <div class="cal-review-comment-head">
                        <strong>${_calEsc(author)}</strong>
                        <span class="cal-review-comment-time">${_calEsc(_calFmtCommentTime(c.created_at))}</span>
                        ${resolvedBadge}
                    </div>
                    <div class="cal-review-comment-body">${_calEsc(c.body || '')}</div>
                </div>`;
        };
        const COLLAPSE_AT = 3;
        const total = comments.length;
        if (total <= COLLAPSE_AT) return comments.map(row).join('');
        const escId = _calEscAttr(item.post.id);
        const escComp = _calEscAttr(comp);
        const toggle = (label) => `<button type="button" class="cal-review-thread-toggle" onclick="_kasperToggleThread('${escId}','${escComp}')">${label}</button>`;
        if (item._threadOpen && item._threadOpen[comp]) return comments.map(row).join('') + toggle('Show less');
        const hidden = total - COLLAPSE_AT;
        return toggle(`Show ${hidden} earlier ${hidden === 1 ? 'message' : 'messages'}`) + comments.slice(total - COLLAPSE_AT).map(row).join('');
    }
    function _kasperToggleThread(pid, comp) {
        const item = _kasperState.items.find(x => x.post && x.post.id === pid);
        if (!item) return;
        if (!item._threadOpen) item._threadOpen = {};
        item._threadOpen[comp] = !item._threadOpen[comp];
        _kasperRepaintCard(pid);
    }
    function _kasperHeroPanel(item, comp) {
        const p = item.post;
        const escId = _calEscAttr(p.id);
        const escComp = _calEscAttr(comp);
        const subStatus = _calNormStatus(p[comp + '_status'] || '');
        const state = subStatus === 'Tweaks Needed' ? 'tweaks'
                    : (subStatus === 'Approved' ? 'approved'
                    : (subStatus === 'Scheduled' ? 'scheduled'
                    : (subStatus === 'Posted' ? 'posted' : 'pending')));
        const inTweaks = state === 'tweaks';
        const isApproved = state === 'approved' || state === 'scheduled' || state === 'posted';
        const draft = (item._drafts && item._drafts[comp]) || '';
        const saving = !!(item._saving && item._saving[comp]);
        const err = (item._errors && item._errors[comp]) || '';
        // Linear chat: render the thread in time order (the comment merge can
        // reorder the stored array) so an SMM reply always lands beneath the
        // message it answers instead of jumping around.
        const comments = _calCommentsFor(p, comp).filter(c => c && !c.deleted && !c.hidden)
            .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        const hasDraft = !!draft.trim();
        const approveEnabled = !saving && !hasDraft && !inTweaks && !isApproved;
        const showApprove = !inTweaks && !isApproved;
        const tweakEnabled = !saving && hasDraft;
        const placeholder = inTweaks ? 'Anything else to add?' : 'Add a note or request a change…';
        const stateLabel = inTweaks ? 'Changes requested' : '';
        const checkIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5L6.5 12L13 4"/></svg>`;
        const sendIco  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>`;
        const resolvedIco = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L5 9.5L10 3.5"/></svg>`;
        const previewHtml = _kasperHeroPreviewHtml(p, comp);
        const threadHtml = _kasperRenderThread(item, comp, comments);
        return `<div class="cal-review-panel kasper-hero-panel" data-comp="${escComp}" data-state="${state}">
            <div class="kasper-hero-left">${previewHtml}</div>
            <div class="kasper-hero-right">
                <div class="kasper-hero-head">
                    <span class="kasper-hero-title">${_calEsc(COMP_LABELS[comp])}</span>
                    ${stateLabel ? `<span class="cal-review-panel-status">${_calEsc(stateLabel)}</span>` : ''}
                </div>
                ${showApprove ? `<div class="cal-review-approve-split">
                    <button type="button" class="cal-review-approve-btn cal-review-approve-main kasper-hero-approve" ${approveEnabled ? '' : 'disabled'} data-idle-title="" title="${hasDraft ? _calEscAttr(REVIEW_APPROVE_DRAFT_TITLE) : ''}" onclick="_kasperApproveComp('${escId}','${escComp}','client')">${checkIco}<span class="cal-ap-verb">${saving ? 'Saving…' : 'Approve'}</span>${saving ? '' : '<span class="cal-ap-route">Client</span>'}</button>
                </div>` : ''}
                <div class="cal-review-panel-compose">
                    <textarea class="cal-review-textarea" placeholder="${_calEscAttr(placeholder)}" oninput="_kasperOnPanelDraftInput(this,'${escId}','${escComp}')">${_calEsc(draft)}</textarea>
                    <div class="cal-review-tweak-actions">
                        <button type="button" class="cal-review-comment-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_kasperAddCommentComp('${escId}','${escComp}')" title="Leave a comment or question — internal only. Doesn't change the status or notify the editor; the card stays awaiting your approval."><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>Comment</button>
                        <button type="button" class="cal-review-aat-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_kasperApproveAfterTweaksComp('${escId}','${escComp}')" title="Send these tweaks and pre-approve for the client — the editor fixes it, then it goes straight to the client (no Kasper re-review)">${checkIco}Approve after tweaks</button>
                        <button type="button" class="cal-review-tweak-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_kasperRequestTweakComp('${escId}','${escComp}')">${sendIco}Request change</button>
                    </div>
                </div>
                ${err ? `<div class="cal-review-panel-err">${_calEsc(err)}</div>` : ''}
                <div class="cal-review-thread">${threadHtml}</div>
            </div>
        </div>`;
    }

    function _kasperPanelHtml(item, comp) {
        const p = item.post;
        const escId = _calEscAttr(p.id);
        const escComp = _calEscAttr(comp);
        const subStatus = _calNormStatus(p[comp + '_status'] || '');
        const state = subStatus === 'Tweaks Needed' ? 'tweaks'
                    : (subStatus === 'Approved' ? 'approved'
                    : (subStatus === 'Scheduled' ? 'scheduled'
                    : (subStatus === 'Posted' ? 'posted' : 'pending')));
        const inTweaks = state === 'tweaks';
        const isApproved = state === 'approved' || state === 'scheduled' || state === 'posted';
        const draft = (item._drafts && item._drafts[comp]) || '';
        const saving = !!(item._saving && item._saving[comp]);
        const err = (item._errors && item._errors[comp]) || '';
        // Linear chat: render the thread in time order (the comment merge can
        // reorder the stored array) so an SMM reply always lands beneath the
        // message it answers instead of jumping around.
        const comments = _calCommentsFor(p, comp).filter(c => c && !c.deleted && !c.hidden)
            .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
        const hasDraft = !!draft.trim();
        const approveEnabled = !saving && !hasDraft && !inTweaks && !isApproved;
        // Approve hides once Kasper has already sent the work back (TN) or
        // signed off — only the "Mark reviewed" / Submit comment paths are
        // relevant from there.
        const showApprove = !inTweaks && !isApproved;
        const tweakEnabled = !saving && hasDraft;
        const placeholder = inTweaks ? 'Anything else to add?' : 'Add a note or request a change…';
        const checkIco = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5L6.5 12L13 4"/></svg>`;
        const sendIco  = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h11M9 3.5L13.5 8L9 12.5"/></svg>`;
        const resolvedIco = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L5 9.5L10 3.5"/></svg>`;
        const previewHtml = _calReviewComponentPreview(p, comp);
        const threadHtml = _kasperRenderThread(item, comp, comments);
        const stateLabel = inTweaks ? 'Changes requested' : '';
        return `<div class="cal-review-panel" data-comp="${escComp}" data-state="${state}">
            <div class="cal-review-panel-head">
                <span class="cal-review-panel-title">${_calEsc(COMP_LABELS[comp])}</span>
                ${stateLabel ? `<span class="cal-review-panel-status">${_calEsc(stateLabel)}</span>` : ''}
            </div>
            <div class="cal-review-panel-preview">${previewHtml}</div>
            ${showApprove ? `<div class="cal-review-approve-split">
                <button type="button" class="cal-review-approve-btn cal-review-approve-main" ${approveEnabled ? '' : 'disabled'} data-idle-title="" title="${hasDraft ? _calEscAttr(REVIEW_APPROVE_DRAFT_TITLE) : ''}" onclick="_kasperApproveComp('${escId}','${escComp}','client')">${checkIco}<span class="cal-ap-verb">${saving ? 'Saving…' : 'Approve'}</span>${saving ? '' : '<span class="cal-ap-route">Client</span>'}</button>
            </div>` : ''}
            <div class="cal-review-panel-compose">
                <textarea class="cal-review-textarea" placeholder="${_calEscAttr(placeholder)}" oninput="_kasperOnPanelDraftInput(this,'${escId}','${escComp}')">${_calEsc(draft)}</textarea>
                <div class="cal-review-tweak-actions">
                    <button type="button" class="cal-review-comment-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_kasperAddCommentComp('${escId}','${escComp}')" title="Leave a comment or question — internal only. Doesn't change the status or notify the editor; the card stays awaiting your approval."><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>Comment</button>
                    <button type="button" class="cal-review-aat-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_kasperApproveAfterTweaksComp('${escId}','${escComp}')" title="Send these tweaks and pre-approve for the client — the editor fixes it, then it goes straight to the client (no Kasper re-review)">${checkIco}Approve after tweaks</button>
                    <button type="button" class="cal-review-tweak-btn" ${tweakEnabled ? '' : 'disabled'} onclick="_kasperRequestTweakComp('${escId}','${escComp}')">${sendIco}Request change</button>
                </div>
            </div>
            ${err ? `<div class="cal-review-panel-err">${_calEsc(err)}</div>` : ''}
            <div class="cal-review-thread">${threadHtml}</div>
        </div>`;
    }

    function _kasperToggleCard(pid) {
        const it = _kasperState.items.find(x => x.post.id === pid);
        if (!it) return;
        it._expanded = !it._expanded;
        _kasperRepaintCard(pid);
    }

    function _kasperRepaintCard(pid) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        const el = document.querySelector('.kcard[data-kasper-pid="' + (window.CSS && CSS.escape ? CSS.escape(pid) : pid) + '"]');
        if (!item || !el) return;
        // Same click-eaten guard as _kasperPaintReview: a slow save landing while
        // Kasper has a button pressed must not replace this card's DOM mid-click.
        // Retry once the pointer is released. (A user action's own synchronous
        // repaint runs from onclick, i.e. after pointerup, so it's never held.)
        if (_kasperPointerHeld) { setTimeout(function () { _kasperRepaintCard(pid); }, 200); return; }
        // Preserve the caret across the rebuild. If Kasper is typing in one of
        // this card's textareas when an after-save repaint fires (e.g. the
        // "thumbnail approved — sent to client" path repaints while he's already
        // writing a caption note), a bare replaceWith destroys that textarea and
        // kicks focus out. The draft text itself survives via item._drafts, so
        // capture the focused textarea (by its unique oninput = pid+comp) + the
        // caret, rebuild, then restore focus to the same box.
        let _restore = null;
        const _a = document.activeElement;
        if (_a && _a.tagName === 'TEXTAREA' && el.contains(_a)) {
            _restore = { sig: _a.getAttribute('oninput') || '', start: _a.selectionStart, end: _a.selectionEnd };
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = _kasperRenderCard(item);
        const newEl = tmp.firstElementChild;
        _kcardReuseThumbInto(el, newEl);   // keep the decoded thumbnail — no blink/reflow on approve/request-change
        el.replaceWith(newEl);
        if (_restore && _restore.sig) {
            const ta = Array.from(newEl.querySelectorAll('textarea')).find(t => (t.getAttribute('oninput') || '') === _restore.sig);
            if (ta) { try { ta.focus(); ta.setSelectionRange(_restore.start, _restore.end); } catch {} }
        }
    }


    /* Save a post to the calendar sheet via the existing upsert webhook.
       Mirrors how the calendar view saves cards: comments get serialised
       into the `tweaks` column on the wire. After the save lands, push
       the status change to Linear so the sub-issue follows. */
    /* The scalar (non-comment) columns Kasper's persist may touch. Used to send
       a FIELD-LEVEL PATCH instead of the whole row: only the scalars that
       changed vs the snapshot the card was loaded with go on the wire, so a
       concurrent change to a DIFFERENT component (e.g. the client approving the
       caption) that Kasper's row still carries a stale value for is NOT
       clobbered. (`status` is derived and handled separately from
       computeOverallStatus; comment cells are always sent and server-merged.) */
    /* ROLLING BACK A REFUSED WRITE HAS TO UNDO BOTH FORMS OF A COMMENT LIST.

       `_calSetCommentsFor` deliberately writes the parsed array AND the
       `*_tweaks` wire string, because `_calMigratePostShape` re-parses the
       array back OUT of the string on every load (cache hydrate, poll, tab
       return). The two rollbacks below restored only the arrays -- and never
       `title_comments` at all -- so a refused note disappeared from the pane
       and stayed in the string, and the next hydrate parsed it straight back
       onto a card whose write had been refused.

       `client_title_approved_at` is here for the same reason: the optimistic
       path clears it through `_calClearStaleApprovals`, which handles title
       separately from CAL_COMPONENTS, and neither rollback put it back.

       Found while repairing the caption refusal it sits next to, not by it:
       the refusal is what made these paths run at all. OPEN_REPAIRS 127. */
    function _kasperCommentSnapshot(post) {
        const snap = { comments: post && post.comments, tweaks: post && post.tweaks,
            client_title_approved_at: post && post.client_title_approved_at };
        for (const comp of ['video', 'graphic', 'caption', 'title']) {
            snap[comp + '_comments'] = post && post[comp + '_comments'];
            snap[comp + '_tweaks'] = post && post[comp + '_tweaks'];
        }
        return snap;
    }

    function _kasperOnPanelDraftInput(ta, pid, comp) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        if (!item) return;
        if (!item._drafts) item._drafts = { video: '', graphic: '', caption: '' };
        item._drafts[comp] = ta.value;
        const nowHasDraft = !!ta.value.trim();
        // Don't repaint — that would yank the textarea out of focus mid-
        // keystroke. Approve / Submit are always rendered now; just toggle
        // their disabled attribute inline.
        const sel = window.CSS && CSS.escape ? CSS.escape(pid) : pid;
        const card = document.querySelector('.kcard[data-kasper-pid="' + sel + '"]');
        if (!card) return;
        const saving = !!(item._saving && item._saving[comp]);
        // Find the panel for this comp (hero panel has no data-comp filter
        // but uses the same component).
        const panel = card.querySelector('.cal-review-panel[data-comp="' + comp + '"]');
        if (!panel) return;
        panel.querySelectorAll('.cal-review-approve-btn, .cal-review-approve-alt').forEach(b => {
            b.disabled = saving || nowHasDraft;
            b.title = nowHasDraft ? REVIEW_APPROVE_DRAFT_TITLE : (b.getAttribute('data-idle-title') || '');
        });
        // Comment + both tweak actions (Request change, Approve after tweaks) require a draft.
        panel.querySelectorAll('.cal-review-tweak-btn, .cal-review-aat-btn, .cal-review-comment-btn').forEach(b => { b.disabled = saving || !nowHasDraft; });
    }

    async function _kasperApproveComp(pid, comp, dest) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        if (!item) return;
        if (!item._saving) item._saving = { video: false, graphic: false, caption: false };
        if (!item._errors) item._errors = { video: null, graphic: null, caption: null };
        if (!item._touchedComps) item._touchedComps = new Set();
        if (item._saving[comp]) return;
        /* The Approve button is already disabled for a component he cannot
           review, but a button is a courtesy and this is the handler: a panel
           rendered before the video URL was cleared still carries a live
           onclick. Same rule as every other writer that targets a review
           status, asked here rather than trusted to the render. */
        const _blocked = _calReviewBlockReason(item.post, comp, 'Client Approval');
        if (_blocked) {
            item._errors[comp] = _blocked;
            _kasperRepaintCard(pid);
            return;
        }
        _kasperInvalidateInFlightLoad();
        item._touchedComps.add(comp);
        const subKey = comp + '_status';
        const prev = {
            [subKey]: item.post[subKey],
            status: item.post.status,
            kasper_approved_at: item.post.kasper_approved_at,
            kasper_seen: item.post.kasper_seen,
        };
        // Kasper approval always forwards the component to the client now (the
        // old "send back to SMM" route was removed — that case is covered by
        // "Approve after tweaks"). Record kasper_seen (cross-device) and stamp
        // the kasper_approved_at sign-off.
        _calRecordKasperSeenOnPost(item.post, comp);
        item.post[subKey] = 'Client Approval';
        item.post.status = computeOverallStatus(item.post);
        item.post.kasper_approved_at = item.post.kasper_approved_at || new Date().toISOString();
        item._saving[comp] = true;
        item._errors[comp] = null;
        _kasperRepaintCard(pid);
        try {
            await _kasperPersistPost(item);
            item._saving[comp] = false;
            _kasperPersistCache();
            // Card-stays rule: keep the card while ANY component is still
            // at Kasper Approval OR Kasper still has unresolved tweaks
            // (those need to live until SMM resolves them, or Kasper
            // explicitly dismisses via Done reviewing).
            const stillKasper = _calComponentsFor(item.post).some(c => _calNormStatus(item.post[c + '_status'] || '') === 'Kasper Approval');
            // Scoped to what Kasper can actually still see: a component he
            // pre-cleared with "approve after tweaks" is no longer his, so its
            // unresolved tweak must not hold the card in his list after he
            // approves the rest of it.
            const stillHasTweaks = _calComponentsFor(item.post)
                .some(c => _calCompKasperVisible(item.post, c) && _calCompHasUnresolvedKasperTweak(item.post, c));
            const _undoCtx = { item: item, comp: comp, prev: prev, entry: null, idx: -1, at: Date.now() };
            if (!stillKasper && !stillHasTweaks) {
                const stamp = item.post.kasper_approved_at || new Date().toISOString();
                const entry = _kasperHistoryEntryFromPost(item.post, item.client, item.slug, stamp);
                _undoCtx.entry = entry;
                _undoCtx.idx = _kasperState.items.findIndex(x => x.post.id === pid);
                _kasperRecordHistory(entry);
                _kasperState.history = _kasperMergeHistory([entry], _kasperState.history);
                _kasperRemoveItem(pid);
            } else {
                _kasperRepaintCard(pid);
            }
            showToast(COMP_LABELS[comp] + ' approved — sent to client', { actionLabel: 'Undo', onAction: () => _kasperUndoApprove(pid, _undoCtx) });
        } catch (e) {
            if (!item.post._writeUiRetrySourceAt) Object.assign(item.post, prev);
            else _kasperPersistCache();
            item._saving[comp] = false;
            item._errors[comp] = _writeUiFailureSentence(e);
            _kasperRepaintCard(pid);
        }
    }

    /* Compensating write for an accidental Approve: restore the snapshot the
       approve took, re-sync the sheet (and Linear, via the same persist path),
       and put the card back in the queue if the approve had completed it.
       If the approve's removal animation is still in flight (240ms), defer —
       its timeout filter would silently drop the just-restored card. */
    async function _kasperUndoApprove(pid, ctx) {
        const item = ctx && ctx.item;
        if (!item) return;
        if (Date.now() - (ctx.at || 0) < 320) { setTimeout(() => _kasperUndoApprove(pid, ctx), 350); return; }
        if (item._saving && item._saving[ctx.comp]) return;
        _kasperInvalidateInFlightLoad();
        Object.assign(item.post, ctx.prev);
        if (item._touchedComps) item._touchedComps.delete(ctx.comp);
        if (ctx.entry) {
            _kasperState.history = (_kasperState.history || []).filter(e => e && e.id !== ctx.entry.id);
            _kasperSaveHistoryLog(_kasperLoadHistoryLog().filter(e => e && e.id !== ctx.entry.id));
        }
        if (!_kasperState.items.some(x => x.post.id === pid)) {
            const at = (ctx.idx >= 0 && ctx.idx <= _kasperState.items.length) ? ctx.idx : 0;
            _kasperState.items.splice(at, 0, item);
        }
        if (!item._saving) item._saving = { video: false, graphic: false, caption: false };
        item._saving[ctx.comp] = true;
        _kasperPersistCache();
        _kasperPaintReview();
        try {
            await _kasperPersistPost(item);
            item._saving[ctx.comp] = false;
            _kasperPersistCache();
            _kasperRepaintCard(pid);
            showToast('Approval undone');
        } catch (e) {
            item._saving[ctx.comp] = false;
            _kasperRepaintCard(pid);
            showNotify('Undo failed', 'Could not write the revert to the sheet (' + ((e && e.message) || 'error') + '). Refresh the queue and check the card before retrying.');
        }
    }

    // Send the tweak straight back to the client after the editor applies it,
    // skipping a Kasper re-review. Same flow as a normal tweak request, plus
    // the persistent "Approved after tweaks" flag.
    async function _kasperApproveAfterTweaksComp(pid, comp) {
        return _kasperRequestTweakComp(pid, comp, true);
    }

    // Kasper leaves a plain comment / question. It lands in the thread as an
    // internal (team-only) note — unlike "Request change" it does NOT flip the
    // component to Tweaks Needed and does NOT ping the editor on Linear, so the
    // card stays exactly where it is (still awaiting his approval). The client
    // never sees it (role:'kasper' + audience:'internal').
    async function _kasperAddCommentComp(pid, comp) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        if (!item) return;
        if (!item._saving) item._saving = { video: false, graphic: false, caption: false };
        if (!item._errors) item._errors = { video: null, graphic: null, caption: null };
        if (!item._drafts) item._drafts = { video: '', graphic: '', caption: '' };
        if (!item._touchedComps) item._touchedComps = new Set();
        const body = String(item._drafts[comp] || '').trim();
        if (!body || item._saving[comp]) return;
        _kasperInvalidateInFlightLoad();
        const prev = Object.assign({ updated_at: item.post.updated_at },
            _kasperCommentSnapshot(item.post));
        const list = _calCommentsFor(item.post, comp).slice();
        const _now = new Date().toISOString();
        list.push({
            id: _calMintCommentId(),
            parent_id: null,
            author: 'Kasper',
            role: 'kasper',
            is_tweak: false,
            audience: 'internal',
            body: body,
            created_at: _now,
            updated_at: _now,
            done: false,
            done_at: '',
            done_by: '',
        });
        _calSetCommentsFor(item.post, comp, list);
        // No status change and no approval clearing — a comment isn't a tweak.
        item.post.updated_at = _now;
        item._touchedComps.add(comp);   // keep the card pinned in his queue
        item._drafts[comp] = '';
        item._saving[comp] = true;
        item._errors[comp] = null;
        _kasperRepaintCard(pid);
        try {
            await _kasperPersistPost(item);
            // Deliberately NO _calPostLinearComment — plain notes don't ping the editor.
            item._saving[comp] = false;
            _kasperPersistCache();
            _kasperRepaintCard(pid);
        } catch (e) {
            Object.assign(item.post, prev);
            item._saving[comp] = false;
            item._errors[comp] = _writeUiFailureSentence(e);
            _kasperRepaintCard(pid);
        }
    }

    async function _kasperRequestTweakComp(pid, comp, approveAfterTweaks) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        if (!item) return;
        if (!item._saving) item._saving = { video: false, graphic: false, caption: false };
        if (!item._errors) item._errors = { video: null, graphic: null, caption: null };
        if (!item._drafts) item._drafts = { video: '', graphic: '', caption: '' };
        if (!item._touchedComps) item._touchedComps = new Set();
        const body = String(item._drafts[comp] || '').trim();
        if (!body || item._saving[comp]) return;
        _kasperInvalidateInFlightLoad();
        // Mirrors the client-review submit: comment lands in the thread,
        // sub-status flips to Tweaks Needed, but the card STAYS in Kasper's
        // queue (locally pinned via _touchedComps) so he can keep layering
        // comments. Removal happens explicitly via "Mark reviewed" or via
        // Approve on a still-KA component.
        const subKey = comp + '_status';
        const prev = Object.assign({
            [subKey]: item.post[subKey],
            status: item.post.status,
            updated_at: item.post.updated_at,
            client_video_approved_at:   item.post.client_video_approved_at,
            client_graphic_approved_at: item.post.client_graphic_approved_at,
            client_caption_approved_at: item.post.client_caption_approved_at,
            kasper_approved_at:         item.post.kasper_approved_at,
            kasper_approved_after_tweaks: item.post.kasper_approved_after_tweaks,
        }, _kasperCommentSnapshot(item.post));
        const list = _calCommentsFor(item.post, comp).slice();
        const _now = new Date().toISOString();
        const newComment = {
            id: _calMintCommentId(),
            parent_id: null,
            author: 'Kasper',
            role: 'kasper',
            is_tweak: true,
            round: _calNextTweakRound(item.post, comp),
            audience: 'internal',
            body: body,
            created_at: _now,
            updated_at: _now,
            done: false,
            done_at: '',
            done_by: '',
        };
        list.push(newComment);
        _calSetCommentsFor(item.post, comp, list);
        item.post[subKey] = 'Tweaks Needed';
        item.post.status = computeOverallStatus(item.post);
        // "Approve after tweaks" pre-clears this component for the client: the
        // editor applies the fix and routes back to For SMM Approval, where the
        // badge tells the SMM it's already cleared by Kasper. A plain "Send"
        // (re-review) supersedes any prior pre-clearance on this component.
        if (approveAfterTweaks) _calRecordApprovedAfterTweaks(item.post, comp);
        else _calClearApprovedAfterTweaks(item.post, comp);
        // Kasper just moved a sub to TN — any prior client_<comp>_approved_at
        // and possibly kasper_approved_at are now stale. Clear them so the
        // sheet row doesn't read "approved at <date>" on a card now in
        // Tweaks Needed. (Persist passes through pending=null since
        // _kasperPersistPost writes the whole row, not a pending diff.)
        _calClearStaleApprovals(item.post, null);
        item.post.updated_at = new Date().toISOString();
        item._touchedComps.add(comp);
        item._drafts[comp] = '';
        item._saving[comp] = true;
        item._errors[comp] = null;
        _kasperRepaintCard(pid);
        let nativeCommentCommitted = false;
        try {
            const linUrl = _calLinearUrlFor(item.post, comp);
            const acknowledgement = await _calPostLinearComment(linUrl, body, 'Kasper', {
                post: item.post, component: comp, comment: newComment, audience: 'internal',
                isTweak: true, round: newComment.round, clientSlug: item.slug,
                repairLane: 'kasper-calendar',
                repairEdits: {
                    [comp + '_status']: item.post[comp + '_status'],
                    status: item.post.status,
                    [comp + '_tweaks']: _calStringifyComments(_calCommentsFor(item.post, comp))
                },
                reserveStatusIntent: { status: item.post[comp + '_status'] }
            });
            nativeCommentCommitted = !!(acknowledgement && acknowledgement.native_committed);
            _writeUiAdoptRepairAck(item.post, acknowledgement);
            const companions = _writeUiRepairCompanions(acknowledgement && acknowledgement.source_repair);
            await _kasperPersistPost(item, {
                precommitted: nativeCommentCommitted,
                refs: acknowledgement && acknowledgement.source_repair ? [acknowledgement.source_repair] : [],
                companions
            });
            item._saving[comp] = false;
            // Persist now so a page reload before the next 30 s poll still
            // remembers the touched flag + TN status.
            _kasperPersistCache();
            _kasperRepaintCard(pid);
        } catch (e) {
            if (!nativeCommentCommitted) {
                Object.assign(item.post, prev);
                item._drafts[comp] = body;
                _writeUiReportFailure('calendar', 'comment', e);
            } else {
                _kasperPersistCache();
                /* Honest wording, not a promise nothing keeps -- and honest about
                   WHICH of the two paths got here, because the retry is not
                   guaranteed to have run. _kasperPersistPostWrite issues it only
                   when the freshness read comes back with a genuinely newer
                   stamp; a failed read, or a stamp no newer than our baseline,
                   is a deliberately supported path that throws the original
                   conflict without a second attempt. `_calRetryIssued` on the
                   error says which happened, so this never claims a retry that
                   did not occur (Codex P2, PR 1493). Either way nothing else
                   retries it after this point -- the sheet write
                   stays refused until a person acts. Said "will retry
                   automatically" here from 2026-07 until this fix, which was
                   simply false: there is no background sweep that replays a
                   refused calendar-upsert call, so the card's Calendar row can
                   sit without this note indefinitely while the dialog told
                   Kasper to expect it to heal itself. */
                showNotify('Card sync incomplete', e && e._calRetryIssued
                    ? 'The native comment is safe. We already retried the Calendar save once and it still did not go through — refresh the calendar, then resend the note if it is still missing.'
                    : 'The native comment is safe, but the Calendar save did not go through and nothing will retry it — refresh the calendar, then resend the note if it is still missing.');
            }
            item._saving[comp] = false;
            item._errors[comp] = _writeUiFailureSentence(e);
            _kasperRepaintCard(pid);
        }
    }

    /* Append one durable, self-describing record per "Finish reviewing" hand-off to
       kasper_finish_log (a JSON array in a text column, like graphic_tweaks).
       kasper_finished_at is a SINGLE OVERWRITTEN stamp (and it stores the latest
       MESSAGE time, not the click time), so on its own it can't show that a finished
       card came back and was finished AGAIN — the fingerprint of the recurring
       re-surface. Each entry is rich enough to CLASSIFY a recurrence without a manual
       Linear lookup:
         • at / prev / gap_min — this click, the previous finish, minutes between.
         • why — 'initial' on the first finish; otherwise, judged vs the prior finish:
             'new-message'  someone OTHER than Kasper replied after he finished;
             'new-round'    a fresh tweak round ran since the previous logged finish
                            (a genuine re-review cycle — the editor reworked + re-asked);
             'recheck'      re-finished with NO new message and NO new round: the card
                            came back with nothing new for him to act on. THIS is the
                            bug-candidate bucket — likely a spurious re-surface; verify
                            in Linear via `links`.
         • statuses / status_at — each component's decision at finish, plus the Linear
           sync change-time for the two synced components (video/graphic).
         • rounds — max tweak round per component (durable; drives 'new-round').
         • links — the Linear issue ids, so a recurrence is one click from its history.
         • last_msg — the newest message {at, role, round, comp} (drives 'new-message').
       Note: 'status-reentered' was dropped — at re-finish the component has already
       been re-decided, so status_at>prev is trivially true and tells us nothing. The
       tweak-round delta is the durable signal instead. Called BEFORE kasper_finished_at
       is overwritten so `prev` is the prior finish. Capped at 50 entries. Additive +
       append-only; SAME column (no migration) — rides KASPER_PATCH_SCALARS. */
    function _kasperAppendFinishLog(post) {
        if (!post) return;
        let log = [];
        try { const a = JSON.parse(post.kasper_finish_log || '[]'); if (Array.isArray(a)) log = a; } catch (e) { log = []; }
        const prev = String(post.kasper_finished_at || '');
        const nowIso = new Date().toISOString();
        // One pass over every component's thread: newest message + max tweak round.
        let comps = [];
        try { comps = _calComponentsFor(post) || []; } catch (e) { comps = ['video', 'graphic', 'caption']; }
        const rounds = {}, statuses = {};
        let lastMsg = null;
        for (const c of comps) {
            try { statuses[c] = _calNormStatus(post[c + '_status'] || '') || null; } catch (e) { statuses[c] = post[c + '_status'] || null; }
            let list = [];
            try { list = _calCommentsFor(post, c) || []; } catch (e) { list = []; }
            let maxRound = 0;
            for (const m of list) {
                if (!m || m.deleted) continue;
                if (m.is_tweak && (Number(m.round) || 0) > maxRound) maxRound = Number(m.round) || 0;
                const at = String(m.created_at || '');
                if (at && (!lastMsg || at > lastMsg.at)) lastMsg = { at: at, role: m.role || null, round: (Number(m.round) || null), comp: c };
            }
            rounds[c] = maxRound;
        }
        const vAt = String(post.video_status_at || '');
        const gAt = String(post.graphic_status_at || '');
        let why = 'initial';
        if (prev) {
            const newMsg = !!(lastMsg && lastMsg.at > prev && lastMsg.role && lastMsg.role !== 'kasper');
            const prevEntry = log.length ? log[log.length - 1] : null;
            const roundsGrew = !!(prevEntry && prevEntry.rounds && comps.some(c =>
                (Number(rounds[c]) || 0) > (Number(prevEntry.rounds[c]) || 0)));
            why = newMsg ? 'new-message' : (roundsGrew ? 'new-round' : 'recheck');
        }
        log.push({
            at: nowIso,
            prev: prev || null,
            gap_min: prev ? Math.round((Date.parse(nowIso) - Date.parse(prev)) / 60000) : null,
            kind: 'handoff',
            why: why,
            statuses: statuses,
            status_at: { video: vAt || null, graphic: gAt || null },
            rounds: rounds,
            links: { video: post.linear_issue_id || null, graphic: post.graphic_linear_issue_id || null },
            last_msg: lastMsg,
            overall: post.status || null
        });
        if (log.length > 50) log = log.slice(-50);
        post.kasper_finish_log = JSON.stringify(log);
    }

    /* "Finish reviewing" — Kasper's explicit "I'm done with this card" exit.
       The button is disabled until every component has an explicit decision
       (approve or request a change); a comment does NOT count, so a card he
       has only commented on can't be finished and stays in his queue. There is
       NO implicit approval and NO status write here:
         • No unresolved tweaks → he approved everything → logged to Approved.
         • Has unresolved tweaks → handed off to the SMM, stamped
           kasper_finished_at (persisted, cross-device) so a refresh on any
           device doesn't drag it back. It returns only when the SMM explicitly
           re-routes an actionable component to Kasper Approval. Replies update
           the thread in place and do not re-open the Waiting bucket. See
           _kasperIsFinished / kasper_finished_at. */
    async function _kasperDismiss(pid) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        if (!item) return;
        const post = item.post;
        // Guard: every component must carry an explicit decision first. No
        // implicit approval — a component still at Kasper Approval with no
        // message from him is undecided and blocks finishing.
        if (_kasperUndecidedComps(post).length) return;
        _kasperInvalidateInFlightLoad();
        // Finish writes NO sub-status (each component already holds its explicit
        // decision: approved → Client Approval, or change requested → Tweaks
        // Needed). Because the guard above blocks finishing while anything is
        // still at Kasper Approval, there are no "parked comment" components to
        // worry about here.
        const anyTweak = _calPostHasUnresolvedKasperTweak(post);
        if (!anyTweak) {
            // Clean approve: he approved everything, nothing outstanding.
            const finalStamp = post.kasper_approved_at || new Date().toISOString();
            const entry = _kasperHistoryEntryFromPost(post, item.client, item.slug, finalStamp);
            _kasperRecordHistory(entry);
            _kasperState.history = _kasperMergeHistory([entry], _kasperState.history);
            _kasperRemoveItem(pid);
        } else {
            // Outstanding change requests, handed to the SMM. Stamp the card
            // FINISHED on the card itself (kasper_finished_at) and PERSIST it —
            // the durable, cross-device hand-off marker that rides the upsert
            // echo + Supabase realtime to every device (like kasper_approved_at),
            // so a refresh on ANY device keeps it in "Tweaks pending". A later
            // reply updates the thread but does not re-surface it; only an explicit
            // actionable Kasper Approval re-route does (see _kasperIsFinished).
            // The local dismissed flag + seen stamp remain continuity fallbacks;
            // the persisted column is deployed (KASPER_REVIEW_GLOBAL_ROLLOUT.md).
            // It does NOT leave the queue: it moves to "Tweaks pending" and stays
            // until the SMM addresses it or a fresh ask supersedes it. Not logged
            // as Approved — it's a hand-off.
            const stamp = _calLatestMsgCreatedAt(post) || new Date().toISOString();
            // Record THIS click durably before we overwrite the single stamp, so a
            // re-finish hours later is visible (kasper_finish_log), with enough context
            // to classify why it came back. The column already ships in the upsert
            // allow-list + Supabase, so this persists end-to-end.
            _kasperAppendFinishLog(post);
            post.kasper_finished_at = stamp;
            _kasperMarkSeenAt(pid, stamp);
            _kasperState.dismissed[pid] = true;
            _kasperPersistCache();
            _kasperPaintReview();
            try { await _kasperPersistPost(item); } catch (e) { /* same-device fallback holds; next successful write reconciles */ }
        }
    }

    /* Explicit close (the X on a card, top-right). No decision required and no
       sub-status is written — it just hides the card. Now GLOBAL + cross-device
       via the persisted kasper_closed_at stamp (see _kasperIsClosed): it stays
       hidden on every device and re-surfaces when a new message lands after the
       close. Pre-backend it falls back to the local _kasperState.closed flag +
       the queue-membership prune in _kasperLoadReview (today's rule: stays gone
       while still parked at Kasper Approval, reappears once re-routed back). */
    function _kasperClose(pid) {
        const item = _kasperState.items.find(x => x.post.id === pid);
        if (!item) return;
        _kasperInvalidateInFlightLoad();
        // Durable, cross-device close marker (kasper_closed_at), persisted like
        // the finish stamp so the card stays hidden on every device; the local
        // `closed` flag is a same-device continuity fallback; the column is live.
        item.post.kasper_closed_at = new Date().toISOString();
        if (!_kasperState.closed || typeof _kasperState.closed !== 'object') _kasperState.closed = {};
        _kasperState.closed[pid] = true;
        _kasperPersistCache();
        _kasperRemoveItem(pid);
        _kasperPersistPost(item).catch(() => {});   // background write; local fallback holds on failure
    }

    function _kasperRemoveItem(pid) {
        _kasperInvalidateInFlightLoad();
        const sel = window.CSS && CSS.escape ? CSS.escape(pid) : pid;
        const el = document.querySelector('.kcard[data-kasper-pid="' + sel + '"]');
        if (el) {
            el.classList.add('is-removing');
            setTimeout(() => {
                _kasperState.items = _kasperState.items.filter(x => x.post.id !== pid);
                _kasperPersistCache();
                _kasperPaintReview();
            }, 240);
        } else {
            _kasperState.items = _kasperState.items.filter(x => x.post.id !== pid);
            _kasperPersistCache();
            _kasperPaintReview();
        }
    }

    /* Build a Slack target URL from whatever the sheet provides. Three
       inputs are accepted, picked in order of reliability:
         • A full Slack profile/DM URL (starts with http/https/slack:).
           Paste from Slack profile → ⋮ → "Copy link to profile".
         • A bare Member ID like "U0ACW93FS30" (or W…). We wrap it in
           Slack's universal app_redirect URL so it opens the right DM
           regardless of workspace, as long as the visitor is logged in.
         • A slack_user_id column with the same Member ID format. */


    /* ── Editors (weekly labor) ─────────────────────────────────────
       Reads public.deliverable_events — every video deliverable with a status
       transition in the previous calendar week (Mon→Sun, America/Chicago),
       grouped per event-time assignee, each carrying only that owner's within-week history.
       See _kedFetchNativeWeek for the shaper and its two correctness traps.
       Work is measured client-side as DELIVERIES (see _kedSplitVideos): the
       editor handing a video off for review (into For SMM / Kasper / Client
       approval) from a state they were holding it in — a first cut (from In
       Progress / Todo) or a tweak round (from Tweak Needed). Reviewer/pipeline
       moves don't count; finishes and work-in-progress are shown separately.
       Cycles weekly: each Monday, "last week" advances by 7 days, so there's
       no continuous logging to maintain. */

    async function _kasperRenderEditors() {
        const root = document.getElementById('kasperContent');
        if (!root) return;
        root.innerHTML = `
            <div class="kasper-toolbar">
                <div class="ked-meta-week" id="kedWeekLabel">&nbsp;</div>
                <div class="ked-toolbar-actions">
                    <div class="ked-avgtoggle" role="group" aria-label="Show totals or per-day averages">
                        <button type="button" class="ked-avgtoggle-btn${_kasperState.editorsAvgMode ? '' : ' is-active'}" data-mode="total" onclick="_kasperSetEditorsAvg(false)">Totals</button>
                        <button type="button" class="ked-avgtoggle-btn${_kasperState.editorsAvgMode ? ' is-active' : ''}" data-mode="avg" onclick="_kasperSetEditorsAvg(true)">Per day</button>
                    </div>
                    <button type="button" class="ked-info-btn" id="kedInfoBtn" onclick="_kedToggleInfo()" aria-label="About this view" title="About this view">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5.5"/><path d="M7 9.7V6.4M7 4.5v.05"/></svg>
                    </button>
                    <button type="button" class="kasper-refresh-btn" id="kedRefresh" onclick="_kasperLoadEditors(true)">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1.5V4h-2.5M3.5 14.5V12H6"/></svg>
                        Refresh
                    </button>
                </div>
            </div>
            <div class="ked-info-panel" id="kedInfoPanel" hidden>
                <p><strong>What this is.</strong> Last week, one row per editor — two numbers side by side: how much was <strong>on his plate</strong> and how much he <strong>pushed through</strong>. The gap between them is the story.</p>
                <p><strong>On his plate (load).</strong> How many videos sat in his court during the week — being edited, or waiting on his tweaks. This is the "how buried was he" number: a video stuck in tweaks for days counts here even if he never got to hand it off. "Still open" = videos that ended the week still parked on him.</p>
                <p><strong>Pushed through (deliveries).</strong> Videos he actually handed off for review that week — a <strong>first cut</strong> (new work) or a <strong>tweak round</strong> (fixed and sent back), to the SMM, Kasper, or the client. <strong>High plate + low pushed-through = blocked or buried, not idle.</strong> <em>Finished</em> (got fully approved) is shown as a separate outcome.</p>
                <p><strong>The bars.</strong> Each bar is one weekday; the number above is how many deliveries landed that day. Higher = busier day.</p>
                <p class="ked-info-note">Heads up: load only counts videos that changed status at least once during the week, so a video that sat completely untouched won't show yet.</p>
                <p><strong>Click an editor.</strong> See every video they touched last week, grouped by client. Each video gets a tiny timeline showing what happened to it across the week.</p>
                <p><strong>Click a single day's bar.</strong> Zoom in on just that day — which clients the editor worked on and how many first cuts vs tweak rounds they delivered.</p>
                <p><strong>Reading the timeline.</strong></p>
                <ul class="ked-info-list">
                    <li><span class="ked-legend-swatch" data-status="in-progress"></span> <strong>Yellow band</strong> — the editor was actively editing.</li>
                    <li><span class="ked-legend-swatch ked-legend-swatch--marker" data-status="smm"></span> <strong>Coloured notch</strong> — a status changed at that moment (sent for SMM / Kasper / client, or tweaks needed).</li>
                    <li><span class="ked-legend-swatch ked-legend-swatch--marker" data-status="approved"></span> <strong>Blue or dark blue cap on the right</strong> — approved or posted. The line ends there.</li>
                    <li><span class="ked-legend-swatch" data-status="todo" style="opacity:0.5"></span> <strong>Empty gap</strong> — the video was sitting in Todo or Backlog. No editor work happening.</li>
                </ul>
                <p class="ked-info-note">Hover any notch or band for the status name.</p>
            </div>
            <div id="kedBody">${_svLoadingSkeletonHtml('kasper', { label: "Loading last week's event-attributed work" })}</div>`;
        const fresh = _kasperState.editorsData && (Date.now() - _kasperState.editorsLoadedAt < 10 * 60 * 1000);
        if (fresh) { _kedPaint(); return; }
        await _kasperLoadEditors(false);
    }

    function _kedToggleInfo() {
        const panel = document.getElementById('kedInfoPanel');
        if (!panel) return;
        panel.hidden = !panel.hidden;
    }

    // Flip the whole tab between weekly totals and per-workday averages.
    function _kasperSetEditorsAvg(on) {
        _kasperState.editorsAvgMode = !!on;
        document.querySelectorAll('.ked-avgtoggle-btn').forEach(b =>
            b.classList.toggle('is-active', (b.dataset.mode === 'avg') === !!on));
        _kedPaint();
    }

    // YYYY-MM-DD for last week's Monday in Chicago time. The workflow's
    // weekStart ISO encodes Chicago midnight Monday, so its UTC date portion
    // matches this string — we use it to invalidate the cache when a new
    // "last week" begins.
    function _kedExpectedLastWeekMondayDate() {
        const TZ = 'America/Chicago';
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
        const parts = fmt.formatToParts(new Date()).reduce((a, p) => { if (p.type !== 'literal') a[p.type] = p.value; return a; }, {});
        const wkMap = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const wd = wkMap[parts.weekday];
        const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
        d.setUTCDate(d.getUTCDate() - (wd - 1) - 7);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const da = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${da}`;
    }
    function _kedLoadEditorsCache() {
        try {
            const raw = localStorage.getItem(KASPER_EDITORS_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.data || !parsed.data.weekStart) return null;
            if (Date.now() - (parsed.fetchedAt || 0) > KASPER_EDITORS_CACHE_MAX_AGE_MS) return null;
            const cachedMon = String(parsed.data.weekStart).split('T')[0];
            if (cachedMon !== _kedExpectedLastWeekMondayDate()) return null;
            return parsed.data;
        } catch (e) { return null; }
    }
    function _kedSaveEditorsCache(data) {
        try { localStorage.setItem(KASPER_EDITORS_CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() })); } catch (e) {}
    }

    /* ── editors-week, natively ──────────────────────────────────────
       Replaces the retired editors-week n8n call (Linear-backed) with a
       direct read of public.deliverable_events, the installed status-transition
       ledger (migrations/2026-07-06-b1-linear-data-model.sql:87, anon-readable
       per its policy at :683). The panel's maths is UNCHANGED: this shaper
       emits exactly the payload _kedPaint/_kedSplitVideos/_kedVideoCourt
       already consume, so every number keeps its existing definition.

       Two things it must get right, both of which silently corrupt the week
       if they are wrong:

       1. dayKey MUST be an America/Chicago calendar date. _kedVideoDeliveries
          falls back to `String(t.at).slice(0,10)` — a UTC date — when dayKey
          is absent, but _kedWeekDateKeys builds the seven bar buckets in
          America/Chicago. Anything after ~19:00 Chicago would land on the next
          day's bar, and Sunday-evening work would fall outside the week's keys
          entirely: counted in the totals, invisible in the bars.
       2. Native status values are not the Linear labels the _ked* predicates
          match on. `tweak` in particular must become 'Tweak Needed' or it
          matches neither _kedIsTweakState (so a tweak round is miscounted as
          a first cut) nor _kedStatusSlug (so the timeline strip loses its
          colour). The map below is the whole translation layer. */
    const _KED_NATIVE_TZ = 'America/Chicago';
    // deliverables.status domain (migrations/2026-07-06-b1-linear-data-model.sql:39-41)
    // → the Linear-shaped label the existing predicates already understand.
    // 'scheduled' has no Linear equivalent and deliberately matches no
    // predicate: it is a post-approval publishing state, not editor work.
    const _KED_NATIVE_STATUS_LABEL = {
        triage:           'Triage',
        backlog:          'Backlog',
        todo:             'Todo',
        in_progress:      'In Progress',
        smm_approval:     'For SMM Approval',
        kasper_approval:  'For Kasper Approval',
        client_approval:  'For Client Approval',
        tweak:            'Tweak Needed',
        approved:         'Approved',
        scheduled:        'Scheduled',
        posted:           'Posted',
        canceled:         'Canceled',
        duplicate:        'Duplicate'
    };
    function _kedNativeLabel(status) {
        const raw = String(status == null ? '' : status).trim();
        if (!raw) return '';
        return _KED_NATIVE_STATUS_LABEL[raw.toLowerCase()] || raw;
    }

    // Minutes that America/Chicago is offset from UTC at a given instant
    // (-300 on CDT, -360 on CST). Derived from Intl rather than hard-coded so
    // the DST boundary inside a week cannot shift a day.
    function _kedTzOffsetMinutes(date) {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone: _KED_NATIVE_TZ, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const p = {};
        for (const part of dtf.formatToParts(date)) { if (part.type !== 'literal') p[part.type] = part.value; }
        const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
        return Math.round((asUTC - date.getTime()) / 60000);
    }
    // The UTC instant of 00:00 America/Chicago on a YYYY-MM-DD date. Two
    // passes so a date whose naive-UTC guess lands on the other side of a DST
    // transition still resolves to the right wall-clock midnight.
    function _kedChicagoMidnightMs(dateStr) {
        const naive = Date.parse(String(dateStr) + 'T00:00:00Z');
        if (isNaN(naive)) return NaN;
        let ms = naive - _kedTzOffsetMinutes(new Date(naive)) * 60000;
        ms = naive - _kedTzOffsetMinutes(new Date(ms)) * 60000;
        return ms;
    }
    const _kedDayKeyFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: _KED_NATIVE_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    // The same key _kedWeekDateKeys stamps on the seven buckets.
    function _kedChicagoDayKey(iso) {
        const ms = Date.parse(iso);
        if (isNaN(ms)) return '';
        return _kedDayKeyFmt.format(new Date(ms));
    }
    function _kedWeekLabel(startMs, endMs) {
        const f = new Intl.DateTimeFormat('en-US', { timeZone: _KED_NATIVE_TZ, month: 'short', day: 'numeric' });
        return f.format(new Date(startMs)) + ' – ' + f.format(new Date(endMs - 1));
    }

    // PostgREST paging. The window routinely exceeds the 1000-row default,
    // and a truncated read is indistinguishable from a quiet week.
    //
    // THE CEILING THROWS RATHER THAN TRUNCATING (Codex, 2026-09-08). This loop
    // used to run a fixed twenty iterations and return whatever it had, so a
    // query matching 20,000 rows or more handed the panel the first 20,000 as
    // if they were all of them -- the SAME silent undercount the pager exists
    // to remove, moved from 1,000 up to 20,000 and made rarer, which is worse,
    // not better: rare and silent is how a wrong number survives long enough to
    // be trusted. It now runs until it OBSERVES a terminal page (a short one,
    // or an empty one when the total is an exact multiple of PAGE), and the
    // ceiling is an assertion rather than a stop: reaching it means the caller
    // asked for a window no week of status events can fill, which is a bug in
    // the query and not a big week. Throwing is right because every caller of
    // this is a COUNT the owner reads as fact -- and the panel already renders
    // a thrown read as an error, where it renders a short one as a quiet week.
    async function _kedRestPage(path) {
        const out = [];
        const PAGE = 1000;
        const MAX_PAGES = 50;              // 50,000 rows; a real week is ~10^2
        for (let page = 0; ; page++) {
            if (page >= MAX_PAGES) {
                // Only the table name -- `path` carries filter values, and this
                // string can reach a console in a PUBLIC repo's CI output.
                throw new Error('_kedRestPage: over ' + (MAX_PAGES * PAGE)
                    + ' rows from ' + String(path).split('?')[0]
                    + '; refusing to report a truncated count');
            }
            const offset = page * PAGE;
            const url = CAL_SUPABASE_URL + '/rest/v1/' + path
                + (path.indexOf('?') === -1 ? '?' : '&') + 'limit=' + PAGE + '&offset=' + offset;
            const resp = await fetch(url, {
                headers: {
                    apikey: CAL_SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY,
                    Accept: 'application/json'
                }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const rows = await resp.json();
            if (!Array.isArray(rows) || !rows.length) break;
            for (const r of rows) out.push(r);
            if (rows.length < PAGE) break;
        }
        return out;
    }
    // `id=in.(...)` has a URL-length ceiling, so ids go out in chunks.
    async function _kedRestIn(table, select, column, ids) {
        const out = [];
        const CHUNK = 120;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK).filter(Boolean);
            if (!slice.length) continue;
            const list = slice.map(v => '"' + String(v).split('"').join('\\"') + '"').join(',');
            const rows = await _kedRestPage(table + '?select=' + select
                + '&' + column + '=in.(' + encodeURIComponent(list) + ')');
            for (const r of rows) out.push(r);
        }
        return out;
    }

    /* Build the editors-week payload from public.deliverable_events.
       Shape returned is byte-compatible with what the retired n8n endpoint
       returned, so nothing downstream changes:
         { weekLabel, weekStart, weekEnd, source, editors:[
             { id, name, email, avatarUrl, videos:[
                 { id, title, clientName, url, transitions:[{at,dayKey,from,status}] } ] } ] } */
    async function _kedFetchNativeWeek() {
        if (!CAL_SUPABASE_URL || !CAL_SUPABASE_ANON_KEY) throw new Error('native_source_unavailable');
        const mondayDate = _kedExpectedLastWeekMondayDate();
        const weekStartMs = _kedChicagoMidnightMs(mondayDate);
        if (isNaN(weekStartMs)) throw new Error('week_window_unresolved');
        // Exclusive end: 00:00 Chicago on the following Monday. Derived from
        // the date seven days on rather than +7*86400000 so a DST week keeps
        // its wall-clock boundary.
        const nextMondayDate = _kedDayKeyFmt.format(new Date(weekStartMs + 7 * 86400000 + 12 * 3600000));
        const weekEndMs = _kedChicagoMidnightMs(nextMondayDate);
        const startISO = new Date(weekStartMs).toISOString();
        const endISO = new Date(weekEndMs).toISOString();

        // Event ownership is a server-side snapshot, not the deliverable's
        // current assignee. The migration labels rows without that proof as
        // `unknown`, and a truly unassigned status change as `unassigned`.
        // Keep both visible in `unattributed` below; do not guess from the
        // current deliverable or from an import/mirror source timestamp.
        const events = await _kedRestPage(
            'deliverable_events?select=deliverable_id,ts,from_status,to_status,event_assignee_id,event_assignee_attribution'
            + '&action=in.(status_change,mirror_in_status_change)'
            + '&ts=gte.' + encodeURIComponent(startISO)
            + '&ts=lt.' + encodeURIComponent(endISO)
            + '&order=ts.asc');

        const byDeliverable = new Map();
        for (const ev of events) {
            const did = ev && ev.deliverable_id;
            if (!did) continue;
            if (!byDeliverable.has(did)) byDeliverable.set(did, []);
            byDeliverable.get(did).push({
                at: ev.ts,
                dayKey: _kedChicagoDayKey(ev.ts),
                from: _kedNativeLabel(ev.from_status),
                status: _kedNativeLabel(ev.to_status),
                ownerId: ev.event_assignee_id || '',
                attribution: ev.event_assignee_attribution || 'unknown'
            });
        }
        const ids = Array.from(byDeliverable.keys());
        const envelope = (editors, unattributed) => ({
            weekLabel: _kedWeekLabel(weekStartMs, weekEndMs),
            weekStart: startISO,
            weekEnd: endISO,
            source: 'native-event-assignee-v1',
            editors,
            unattributed
        });
        if (!ids.length) return envelope([], { unknown: 0, unassigned: 0 });

        // Do not use deliverables.assignee_id here. It is the CURRENT owner,
        // so doing so would move a prior editor's work after reassignment.
        let deliverables = (await _kedRestIn(
            'deliverables', 'id,title,client_slug,kind,linear_issue_url', 'id', ids))
            .filter(d => d && d.kind === 'video');
        if (!deliverables.length) return envelope([], { unknown: 0, unassigned: 0 });

        const clientSlugs = Array.from(new Set(deliverables.map(d => d.client_slug).filter(Boolean)));
        const clients = clientSlugs.length
            ? await _kedRestIn('clients', 'slug,display_name,kind', 'slug', clientSlugs)
            : [];
        const clientBySlug = new Map(clients.map(c => [c.slug, c.display_name]));
        /* TEST AND INTERNAL CLIENTS ARE NOT EDITOR PRODUCTION. Exclude by
           `kind`, not `active`: offboarded real work stays in history, while
           a missing registry row is retained under the permissive UI rule. */
        const nonProductionSlugs = new Set(clients
            .filter(c => ['test', 'internal'].includes(String(c && c.kind || '').trim().toLowerCase()))
            .map(c => c.slug));
        if (nonProductionSlugs.size) deliverables = deliverables.filter(d => !nonProductionSlugs.has(d.client_slug));
        if (!deliverables.length) return envelope([], { unknown: 0, unassigned: 0 });

        const ownerIds = Array.from(new Set(
            deliverables.flatMap(d => (byDeliverable.get(d.id) || [])
                .filter(t => t.attribution === 'native_transaction' && t.ownerId)
                .map(t => t.ownerId))));
        // `active` is display metadata only. Inactive people retain their
        // earned history; a deleted roster row gets a neutral former-editor
        // label without reconstructing a name or email.
        const members = ownerIds.length
            ? await _kedRestIn('team_members', 'id,name,role,active', 'id', ownerIds)
            : [];
        const memberById = new Map(members.map(m => [m.id, m]));
        const byEditor = new Map();
        const unattributed = { unknown: 0, unassigned: 0 };

        for (const d of deliverables) {
            const perOwner = new Map();
            for (const t of (byDeliverable.get(d.id) || [])) {
                if (t.attribution === 'native_transaction' && t.ownerId) {
                    if (!perOwner.has(t.ownerId)) perOwner.set(t.ownerId, []);
                    perOwner.get(t.ownerId).push(t);
                } else if (t.attribution === 'unassigned') {
                    unattributed.unassigned++;
                } else {
                    unattributed.unknown++;
                }
            }
            for (const [ownerId, transitions] of perOwner) {
                const m = memberById.get(ownerId);
                if (!byEditor.has(ownerId)) {
                    byEditor.set(ownerId, m
                        ? { id: m.id, name: m.name, email: '', avatarUrl: null, inactive: m.active === false, videos: [] }
                        : { id: ownerId, name: 'Former editor', email: '', avatarUrl: null, inactive: true, removed: true, videos: [] });
                }
                byEditor.get(ownerId).videos.push({
                    id: d.id,
                    title: d.title,
                    clientName: clientBySlug.get(d.client_slug) || '',
                    url: d.linear_issue_url || '',
                    transitions: transitions.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))
                });
            }
        }
        return envelope(Array.from(byEditor.values()), unattributed);
    }

    async function _kasperLoadEditors(forceRefresh) {
        const body = document.getElementById('kedBody');
        const btn  = document.getElementById('kedRefresh');

        // Last week's data never changes — hit localStorage first unless the
        // user explicitly hit Refresh. Cross-week boundary invalidates.
        if (!forceRefresh) {
            const cached = _kedLoadEditorsCache();
            if (cached) {
                _kasperState.editorsData = cached;
                _kasperState.editorsLoadedAt = Date.now();
                _kedPaint();
                return;
            }
        }

        if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
        if (body && (forceRefresh || !_kasperState.editorsData)) body.innerHTML = _svLoadingSkeletonHtml('kasper', { label: forceRefresh ? 'Refreshing editor work' : "Loading last week's work" });
        _kasperState.editorsLoading = true;
        _kasperState.editorsError = null;
        try {
            const json = await _kedFetchNativeWeek();
            if (!json || json.ok === false) throw new Error((json && json.error) || 'Unknown error');
            _kasperState.editorsData = json;
            _kasperState.editorsLoadedAt = Date.now();
            _kedSaveEditorsCache(json);
            _kedPaint();
        } catch (e) {
            _kasperState.editorsError = e && e.message ? e.message : String(e);
            const b = document.getElementById('kedBody');
            if (b) b.innerHTML = `<div class="kasper-empty">
                <div class="kasper-empty-title">Couldn't load editor stats</div>
                <div class="kasper-empty-sub">${_calEsc(_kasperState.editorsError)}</div>
            </div>`;
        } finally {
            _kasperState.editorsLoading = false;
            if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
        }
    }

    function _kedPaint() {
        const data = _kasperState.editorsData;
        const body = document.getElementById('kedBody');
        if (!body || !data) return;
        // Historical attribution must retain inactive/removed roster identity.
        // This view is history, not a current staffing picker.
        const editors = Array.isArray(data.editors) ? data.editors : [];
        const unattributed = data.unattributed || {};
        const unknown = Number(unattributed.unknown || 0);
        const unassigned = Number(unattributed.unassigned || 0);
        const attributionNote = (unknown || unassigned)
            ? `<div class="ked-empty-sub">${unknown ? `${unknown} status ${unknown === 1 ? 'change has' : 'changes have'} no event-time assignee proof and ${unknown === 1 ? 'is' : 'are'} not credited.` : ''}${unknown && unassigned ? ' ' : ''}${unassigned ? `${unassigned} ${unassigned === 1 ? 'change was' : 'changes were'} unassigned at the event and ${unassigned === 1 ? 'is' : 'are'} not credited.` : ''}</div>`
            : '';

        const weekEl = document.getElementById('kedWeekLabel');
        if (weekEl) weekEl.textContent = data.weekLabel || 'Last week';

        if (!editors.length) {
            body.innerHTML = `<div class="ked-empty-msg">No editor deliveries with event-time attribution last week.${attributionNote}</div>`;
            return;
        }

        // Shared y-axis across all editors so per-day bars are visually comparable.
        let globalDailyMax = 1;
        for (const ed of editors) {
            const perDay = _kedEditorStats(ed).perDay;
            for (const k of Object.keys(perDay)) {
                if (perDay[k] > globalDailyMax) globalDailyMax = perDay[k];
            }
        }
        const weekDates = _kedWeekDateKeys(data.weekStart);
        const anyWeekendActivity = editors.some(ed => {
            const pd = _kedEditorStats(ed).perDay;
            const sat = weekDates[5] && pd[weekDates[5].key];
            const sun = weekDates[6] && pd[weekDates[6].key];
            return (sat || 0) + (sun || 0) > 0;
        });

        const rows = editors.map(ed => _kedRow(ed, weekDates, globalDailyMax, anyWeekendActivity)).join('');
        body.innerHTML = `<div class="ked-list">${rows}</div>${attributionNote}`;
    }

    function _kedWeekDateKeys(weekStartISO) {
        // weekStartISO is UTC midnight that corresponds to Chicago Monday.
        // We want the 7 date keys in America/Chicago (Mon..Sun) so they
        // match the keys that the server stamps onto perDay.
        const TZ = 'America/Chicago';
        const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const start = new Date(weekStartISO);
        const out = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(start.getTime() + i * 86400000);
            const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
            out.push({ key, label: labels[i], date: d });
        }
        return out;
    }

    function _kedInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function _kedDayLong(short) {
        return { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[short] || short;
    }

    // ── Editor work model ───────────────────────────────────────────
    // "How much did an editor ship?" is counted in DELIVERIES. A delivery is
    // the editor handing a video off for review: a transition whose TARGET is
    // a review column (For SMM / Kasper / Client approval) and whose PREVIOUS
    // state was one the editor was holding the video in (In Progress, Todo,
    // Backlog, Tweak Needed).
    //   • from Tweak Needed  → a tweak round (re-work delivered)
    //   • from anything else → a first cut   (new work delivered)
    // Reviewer / pipeline moves are NOT deliveries and never count as editor
    // work: review→review (SMM→Kasper, Kasper→Client), review→Tweak Needed
    // (reviewer asking for changes), →Approved/Posted (sign-off), Todo→In
    // Progress (just picking it up). Finishes (reached Approved/Posted) and
    // work-in-progress (started, not yet delivered) are tracked separately as
    // outcomes — they are not folded into the work number.
    //
    // Real Linear statuses carry quirks — trailing spaces ("Tweak Needed ")
    // and mixed case ("For SMM approval" vs "For Client Approval") — so every
    // comparison normalises through _kedNorm first.
    function _kedNorm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

    // Target of a delivery. Loose keyword match (robust to "For SMM approval"
    // and future "SMM Approval" style renames). Only meaningful paired with the
    // from-is-a-work-state check below — on its own it also matches a reviewer
    // moving a video INTO a review column.
    function _kedReviewTarget(norm) {
        if (/smm/.test(norm))           return 'smm';
        if (/kasper|casper/.test(norm)) return 'kasper';
        if (/client/.test(norm))        return 'client';
        return null;
    }
    function _kedIsTweakState(norm) {
        return norm === 'tweak needed' || norm === 'tweaks needed';
    }
    // States the editor holds a video in; a move OUT of one INTO a review
    // column is the editor delivering.
    function _kedIsWorkState(norm) {
        return norm === 'in progress'
            || norm === 'todo' || norm === 'to do'
            || norm === 'backlog'
            || _kedIsTweakState(norm);
    }
    function _kedIsFinishState(norm) {
        return norm === 'approved' || norm === 'posted';
    }

    // The deliveries for one video, de-bounced. Status-flip noise (a video
    // toggled in and out of a review column several times the same day) is
    // collapsed to at most one delivery per (day, kind), so a couple of stray
    // clicks don't read as extra rounds. Memoised on the video object.
    function _kedVideoDeliveries(v) {
        if (v && v._kedDeliveries) return v._kedDeliveries;
        const trs = ((v && v.transitions) || []).slice()
            .sort((a, b) => String(a.at).localeCompare(String(b.at)));
        const seen = new Set();
        const out = [];
        for (const t of trs) {
            if (!_kedReviewTarget(_kedNorm(t.status))) continue; // must land in a review column
            const from = _kedNorm(t.from);
            if (!_kedIsWorkState(from)) continue;                // must come from an editor-held state
            const dayKey = t.dayKey || String(t.at || '').slice(0, 10);
            const kind = _kedIsTweakState(from) ? 'tweak' : 'firstcut';
            const key = dayKey + '|' + kind;
            if (seen.has(key)) continue;                         // de-bounce same (day, kind)
            seen.add(key);
            out.push({ at: t.at, dayKey, kind });
        }
        if (v) { try { Object.defineProperty(v, '_kedDeliveries', { value: out, enumerable: false }); } catch (e) { v._kedDeliveries = out; } }
        return out;
    }
    function _kedVideoFinished(v) {
        return ((v && v.transitions) || []).some(t => _kedIsFinishState(_kedNorm(t.status)));
    }
    // Started but not delivered: has an In Progress transition, no delivery
    // this week, and never reached a finish state.
    function _kedVideoIsWip(v) {
        if (_kedVideoDeliveries(v).length) return false;
        if (_kedVideoFinished(v)) return false;
        return ((v && v.transitions) || []).some(t => _kedNorm(t.status) === 'in progress');
    }

    // "In his court" = the ball is with the editor: actively editing (In
    // Progress) or owing a fix (Tweaks Needed). Waiting on a reviewer, done,
    // or sitting in Todo is NOT his court.
    function _kedIsCourtState(norm) {
        return norm === 'in progress' || _kedIsTweakState(norm);
    }
    // How long a video sat in his court during the week — the "load" signal.
    // Reconstructed from the transition timeline: the state before the first
    // in-window event holds from weekStart; each event flips the state until
    // weekEnd. editingMs (In Progress) and tweakMs (Tweaks Needed) are the time
    // the ball was with him; endInCourt = still parked on him at week's end.
    // (Only sees videos that had ≥1 in-window transition — a video that sat
    // untouched all week isn't in the payload at all; richer once the server
    // selection widens.)
    function _kedVideoCourt(v, weekStartMs, weekEndMs) {
        const trs = ((v && v.transitions) || []).slice()
            .sort((a, b) => String(a.at).localeCompare(String(b.at)));
        if (!trs.length || !(weekEndMs > weekStartMs)) return { editingMs: 0, tweakMs: 0, endInCourt: false };
        let editingMs = 0, tweakMs = 0, cursor = weekStartMs, state = _kedNorm(trs[0].from);
        const add = (st, fromMs, toMs) => {
            const dur = Math.min(toMs, weekEndMs) - Math.max(fromMs, weekStartMs);
            if (dur <= 0) return;
            if (st === 'in progress') editingMs += dur;
            else if (_kedIsTweakState(st)) tweakMs += dur;
        };
        for (const t of trs) {
            const tMs = Date.parse(t.at);
            if (!isNaN(tMs)) { add(state, cursor, tMs); cursor = tMs; }
            state = _kedNorm(t.status);
        }
        add(state, cursor, weekEndMs);
        return { editingMs, tweakMs, endInCourt: _kedIsCourtState(state) };
    }

    // Roll a video list up into the numbers a row renders. All headline numbers
    // are VIDEO counts. On his plate = loadVideos (every video he worked on),
    // split into newVideos + tweakVideos + inProgVideos (which add up to it).
    // finishes = reached Approved/Posted; stillOpen = still in his court at
    // week's end. perDay counts sends per Chicago day for the bars. Per-video
    // rework (how many times a video was re-sent) is shown in the drill-down,
    // not here — see _kedVideoCard.
    function _kedSplitVideos(videos, weekStartMs, weekEndMs) {
        let firstCuts = 0, tweakRounds = 0, finishes = 0, wip = 0, touched = 0;
        let loadVideos = 0, newVideos = 0, tweakVideos = 0, inProgVideos = 0, stillOpen = 0;
        const perDay = {};
        for (const v of (videos || [])) {
            const ds = _kedVideoDeliveries(v);
            const fin = _kedVideoFinished(v);
            const isWip = _kedVideoIsWip(v);
            for (const d of ds) {
                if (d.kind === 'tweak') tweakRounds++; else firstCuts++;
                perDay[d.dayKey] = (perDay[d.dayKey] || 0) + 1;
            }
            if (fin) finishes++;
            else if (isWip) wip++;
            const court = _kedVideoCourt(v, weekStartMs, weekEndMs);
            const worked = court.editingMs > 0 || court.tweakMs > 0 || ds.length > 0;
            if (worked) {
                loadVideos++;
                // Every worked-on video is exactly one of: new (delivered a
                // first cut), tweak (only tweak fixes), or in progress (not
                // sent yet). The three add up to loadVideos.
                if (ds.length) { if (ds.some(d => d.kind === 'firstcut')) newVideos++; else tweakVideos++; }
                else inProgVideos++;
            }
            if (worked || fin) touched++;
            if (court.endInCourt) stillOpen++;
        }
        return { firstCuts, tweakRounds, finishes, wip, touched, perDay,
                 loadVideos, newVideos, tweakVideos, inProgVideos, stillOpen };
    }

    // Per-editor stats, memoised on the editor object so _kedPaint (shared
    // y-axis) and _kedRow (bars + headline) compute them once.
    function _kedEditorStats(ed) {
        if (ed && ed._kedStats) return ed._kedStats;
        const data = _kasperState.editorsData || {};
        const wsMs = Date.parse(data.weekStart), weMs = Date.parse(data.weekEnd);
        const s = _kedSplitVideos((ed && ed.videos) || [], wsMs, weMs);
        if (ed) { try { Object.defineProperty(ed, '_kedStats', { value: s, enumerable: false }); } catch (e) { ed._kedStats = s; } }
        return s;
    }

    // Plain-English hover copy for each number — explains what it counts, for
    // someone who doesn't know the internal vocabulary. Same in either view.
    const _KED_TIPS = {
        plate:    "How many different videos he worked on last week — new edits, tweak fixes, and ones still in progress (these add up to this number).",
        finished: "Videos that got fully approved or posted last week — they crossed the finish line.",
        open:     "Videos still on his plate at the end of the week — not yet finished or sent back.",
        newCut:   "Brand-new videos he edited and sent on for review for the first time.",
        tweakFix: "Videos that came back for changes, which he fixed and re-sent.",
        inProg:   "Videos he was still working on and hadn't sent for review yet.",
    };

    function _kedRow(ed, weekDates, globalDailyMax, showWeekend) {
        const key = ed.id || ed.email || ed.name;
        const expanded = !!_kasperState.editorsExpanded[key];
        const dayFilter = _kasperState.editorsDayFilter[key] || null;
        const days = showWeekend ? weekDates : weekDates.slice(0, 5);
        const stats = _kedEditorStats(ed);
        const avatarHtml = ed.avatarUrl
            ? `<img loading="lazy" src="${_calEscAttr(ed.avatarUrl)}" alt="" onerror="this.replaceWith(_kedAvatarFallback(${_jsAttrArg(ed.name || '')}))">`
            : _calEsc(_kedInitials(ed.name));
        const bars = days.map(d => {
            const count = stats.perDay[d.key] || 0;
            const pct = Math.max(0, Math.min(1, count / globalDailyMax));
            const heightPct = count > 0 ? Math.max(0.12, pct) * 100 : 0;
            const seg = count > 0 ? `<div class="ked-bar-seg" style="height:${heightPct.toFixed(2)}%;"></div>` : '';
            const isSel = dayFilter === d.key;
            const stackCls = ['ked-bar-stack', count === 0 ? 'is-empty' : 'is-clickable', isSel ? 'is-selected' : ''].filter(Boolean).join(' ');
            const dayLong = _kedDayLong(d.label);
            const sentLbl = `${count} video${count === 1 ? '' : 's'} sent for review`;
            const tipText = count === 0
                ? `${dayLong} · nothing sent for review`
                : isSel
                    ? `${dayLong} · ${sentLbl} — click to clear`
                    : `${dayLong} · ${sentLbl} — click to view`;
            const onclickAttr = count > 0
                ? ` onclick="event.stopPropagation();_kasperToggleEditorDay('${_calEscAttr(key)}','${d.key}')"`
                : '';
            return `<div class="ked-bar">
                <div class="ked-bar-count${count === 0 ? ' is-empty' : ''}">${count || '·'}</div>
                <div class="${stackCls}" data-tip="${_calEscAttr(tipText)}"${onclickAttr}>
                    ${seg}
                </div>
                <div class="ked-bar-label">${d.label}</div>
            </div>`;
        }).join('');

        const avg = !!_kasperState.editorsAvgMode;        // Totals vs Per-day toggle
        const tipAttr = k => ` data-tip="${_calEscAttr(_KED_TIPS[k])}"`;
        const perWk = n => avg ? Math.round(n / 5) : n;   // per-workday average (rounded) when toggled

        // ON HIS PLATE — every video he worked on, split new / tweaks / still in
        // progress. The three add up to the plate number.
        const loadParts = [];
        if (stats.newVideos)    loadParts.push(`<span${tipAttr('newCut')}>${perWk(stats.newVideos)} new</span>`);
        if (stats.tweakVideos)  loadParts.push(`<span${tipAttr('tweakFix')}>${perWk(stats.tweakVideos)} tweaks</span>`);
        if (stats.inProgVideos) loadParts.push(`<span${tipAttr('inProg')}>${perWk(stats.inProgVideos)} in progress</span>`);
        if (!loadParts.length)  loadParts.push('—');
        const loadSub = loadParts.join(' <span class="ked-id-sep">·</span> ');
        const loadBig = perWk(stats.loadVideos);
        const loadLabel = avg ? 'on his plate / day' : 'on his plate';

        // FINISHED and STILL OPEN are outcome counts — always weekly totals.
        const finBig = stats.finishes;
        const openBig = stats.stillOpen;

        const videosBlock = expanded ? _kedVideos(ed.videos || [], dayFilter, ed.weekStart || (_kasperState.editorsData && _kasperState.editorsData.weekStart), ed.weekEnd || (_kasperState.editorsData && _kasperState.editorsData.weekEnd), key, days) : '';
        return `<div class="ked-row${expanded ? ' expanded' : ''}${dayFilter ? ' is-day-filtered' : ''}" data-ked-key="${_calEscAttr(key)}">
            <div class="ked-row-head" onclick="_kasperToggleEditor(${_jsAttrArg(key)})">
                <div class="ked-avatar">${avatarHtml}</div>
                <div class="ked-id">
                    <div class="ked-name">${_calEsc(ed.name || 'Unknown')}</div>
                </div>
                <div class="ked-row-stats">
                    <div class="ked-stat is-load">
                        <span class="ked-stat-val">${loadBig}</span>
                        <span class="ked-stat-label"${tipAttr('plate')}>${loadLabel}</span>
                        <div class="ked-stat-sub">${loadSub}</div>
                    </div>
                    <div class="ked-stat-sep"></div>
                    <div class="ked-stat is-finished">
                        <span class="ked-stat-val">${finBig}</span>
                        <span class="ked-stat-label"${tipAttr('finished')}>finished</span>
                    </div>
                    <div class="ked-stat-sep"></div>
                    <div class="ked-stat is-open">
                        <span class="ked-stat-val">${openBig}</span>
                        <span class="ked-stat-label"${tipAttr('open')}>still open</span>
                    </div>
                </div>
                <svg class="ked-row-chev" width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5l4 4 4-4"/></svg>
            </div>
            <div class="ked-bars${showWeekend ? ' with-weekend' : ''}">${bars}</div>
            ${videosBlock}
        </div>`;
    }

    // Map a Linear state name to a stable slug used for the colour palette.
    function _kedStatusSlug(name) {
        const n = String(name || '').toLowerCase().trim();
        if (!n) return 'other';
        if (/^in\s*progress/.test(n))     return 'in-progress';
        if (/smm/.test(n))                return 'smm';
        if (/kasper/.test(n))             return 'kasper';
        if (/client/.test(n))             return 'client';
        if (/tweak\s*needed/.test(n))     return 'tweak-needed';
        if (/^approved/.test(n))          return 'approved';
        if (/^posted/.test(n))            return 'posted';
        if (/^todo|^to do|^triage/.test(n)) return 'todo';
        if (/^backlog/.test(n))           return 'backlog';
        if (/^cancel|^duplicate/.test(n)) return 'canceled';
        return 'other';
    }
    const _KED_STATUS_LABELS = {
        'in-progress':   'In Progress',
        'smm':           'For SMM',
        'kasper':        'For Kasper',
        'client':        'For Client',
        'tweak-needed':  'Tweak Needed',
        'approved':      'Approved',
        'posted':        'Posted',
        'todo':          'Todo',
        'backlog':       'Backlog',
        'canceled':      'Canceled',
        'other':         '—'
    };

    // Classify each status by how it should render on the timeline strip:
    //   work     — coloured time-occupying segment
    //   instant  — thin marker at the transition point (no time width)
    //   terminal — small cap at the transition point; line ends here
    //   hidden   — not rendered at all (the strip just doesn't exist for that span)
    function _kedClassifyKind(slug) {
        if (slug === 'todo' || slug === 'backlog')                           return 'hidden';
        if (slug === 'in-progress')                                          return 'work';
        if (slug === 'approved' || slug === 'posted' || slug === 'canceled') return 'terminal';
        return 'marker';
    }

    // Build the render-ready segments. Hidden states are dropped (creating
    // a gap on the strip). Work segments stretch from their actual start
    // to the next visible segment's start, so they visually abut the next
    // marker — no awkward empty time between them. Markers/terminals are
    // returned with widthPct = 0; the CSS sets their visual width.
    function _kedBuildSegments(transitions, weekStartMs, weekEndMs) {
        if (!transitions || !transitions.length) return [];
        const total = weekEndMs - weekStartMs;
        if (total <= 0) return [];
        const raw = [];
        const first = transitions[0];
        const firstMs = Math.max(weekStartMs, Math.min(weekEndMs, Date.parse(first.at)));
        if (first.from && firstMs > weekStartMs) {
            raw.push({ status: first.from, startMs: weekStartMs, endMs: firstMs });
        }
        for (let i = 0; i < transitions.length; i++) {
            const t = transitions[i];
            const start = Math.max(weekStartMs, Math.min(weekEndMs, Date.parse(t.at)));
            const end = i < transitions.length - 1
                ? Math.max(weekStartMs, Math.min(weekEndMs, Date.parse(transitions[i + 1].at)))
                : weekEndMs;
            raw.push({ status: t.status, startMs: start, endMs: end });
        }

        // Drop hidden states (Todo/Backlog don't count as workload).
        const visible = raw
            .map(s => ({ ...s, slug: _kedStatusSlug(s.status), kind: _kedClassifyKind(_kedStatusSlug(s.status)) }))
            .filter(s => s.kind !== 'hidden');

        const segs = [];
        for (let i = 0; i < visible.length; i++) {
            const s = visible[i];
            const startPct = ((s.startMs - weekStartMs) / total) * 100;
            if (s.kind === 'terminal') {
                segs.push({ status: s.status, slug: s.slug, kind: 'terminal', startMs: s.startMs, endMs: s.startMs, startPct, widthPct: 0 });
                break; // line ends at the terminal cap
            }
            if (s.kind === 'marker') {
                segs.push({ status: s.status, slug: s.slug, kind: 'marker', startMs: s.startMs, endMs: s.startMs, startPct, widthPct: 0 });
                continue;
            }
            // work — extend to the next visible segment's start (or the end of the week)
            const next = visible[i + 1];
            const visualEndMs = next ? next.startMs : weekEndMs;
            const widthPct = Math.max(0.4, ((visualEndMs - s.startMs) / total) * 100);
            segs.push({ status: s.status, slug: s.slug, kind: 'work', startMs: s.startMs, endMs: visualEndMs, startPct, widthPct });
        }
        return segs;
    }

    // Per-client per-day breakdown for the day-filter summary chips: the
    // deliveries (first cuts / tweak rounds) that landed on the selected day.
    // Same delivery model as the bars, so `Σ chip counts === bar count`.
    function _kedClientDaySummary(videos, dayKey) {
        let firstCuts = 0, tweakRounds = 0;
        for (const v of (videos || [])) {
            for (const d of _kedVideoDeliveries(v)) {
                if (d.dayKey !== dayKey) continue;
                if (d.kind === 'tweak') tweakRounds++; else firstCuts++;
            }
        }
        return { firstCuts, tweakRounds };
    }

    // A video is "in the day's filter" iff it had a delivery on that day —
    // i.e. it contributed to that day's bar count.
    function _kedVideoContributedOnDay(v, dayKey) {
        return _kedVideoDeliveries(v).some(d => d.dayKey === dayKey);
    }

    function _kedClientIsExpanded(editorKey, clientName, defaultExpanded) {
        const ed = _kasperState.editorsClientExpanded[editorKey];
        if (!ed || !(clientName in ed)) return defaultExpanded;
        return !!ed[clientName];
    }

    function _kedVideos(videos, dayFilter, weekStartISO, weekEndISO, editorKey, days) {
        if (!videos || !videos.length) {
            return `<div class="ked-vid-empty">No videos to show.</div>`;
        }
        const weekStartMs = Date.parse(weekStartISO);
        const weekEndMs = Date.parse(weekEndISO);

        // When a day is selected, show only the sub-issues that contributed
        // to that day's bar count. The selected bar in the chart above acts
        // as the visual filter indicator — click it again to clear.
        const filtered = dayFilter
            ? videos.filter(v => _kedVideoContributedOnDay(v, dayFilter))
            : videos;

        const dayLabelsHtml = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
            .map((lbl, i) => `<span class="ked-vid-axis-day" style="left:${((i + 0.5) / 7) * 100}%;">${lbl}</span>`)
            .join('');

        // Always group by client. Whole-week view defaults each group to
        // expanded (Kasper wants to see the strips immediately). Day-filter
        // view defaults each group to collapsed with a summary chip row so
        // the page reads as a compact "who/what" table.
        const defaultExpanded = !dayFilter;
        const groups = new Map();
        for (const v of filtered) {
            const c = v.clientName || 'No client';
            if (!groups.has(c)) groups.set(c, []);
            groups.get(c).push(v);
        }
        const sortedClients = Array.from(groups.keys()).sort((a, b) => {
            if (a === 'No client') return 1;
            if (b === 'No client') return -1;
            return a.localeCompare(b);
        });

        // "Expand all / Collapse all" depends on what proportion of clients
        // are currently expanded. If they're all expanded, the toggle
        // collapses everything; otherwise it expands everything.
        const expandedCount = sortedClients.reduce((n, c) =>
            n + (_kedClientIsExpanded(editorKey, c, defaultExpanded) ? 1 : 0), 0);
        const allExpanded = expandedCount === sortedClients.length;
        const toolbarHtml = sortedClients.length > 1 ? `
            <div class="ked-vid-toolbar">
                <span class="ked-vid-toolbar-meta">${sortedClients.length} client${sortedClients.length === 1 ? '' : 's'}${dayFilter ? ' · ' + _kedDayLong((days || []).find(d => d.key === dayFilter)?.label || '') : ''}</span>
                <button type="button" class="ked-vid-toolbar-btn" onclick="_kasperToggleAllClients(${_jsAttrArg(editorKey)})">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        ${allExpanded
                            ? '<path d="M2 7l4-3 4 3"/><path d="M2 10l4-3 4 3"/>'
                            : '<path d="M2 5l4 3 4-3"/><path d="M2 2l4 3 4-3"/>'}
                    </svg>
                    ${allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
            </div>` : '';

        const bodyHtml = sortedClients.map(c => {
            const vids = groups.get(c);
            vids.sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt)));
            const expanded = _kedClientIsExpanded(editorKey, c, defaultExpanded);
            let summaryHtml = '';
            if (dayFilter) {
                const sum = _kedClientDaySummary(vids, dayFilter);
                const chips = [];
                if (sum.firstCuts)   chips.push(`<span class="ked-group-chip" data-tip="First cuts delivered for review that day"><span class="ked-chip-n">${sum.firstCuts}</span> first cut${sum.firstCuts === 1 ? '' : 's'}</span>`);
                if (sum.tweakRounds) chips.push(`<span class="ked-group-chip" data-tip="Tweak rounds delivered for review that day"><span class="ked-chip-n">${sum.tweakRounds}</span> tweak${sum.tweakRounds === 1 ? '' : 's'}</span>`);
                summaryHtml = chips.length ? `<div class="ked-group-summary">${chips.join('')}</div>` : '';
            }
            const headCls = expanded ? 'ked-vid-group-head is-expanded' : 'ked-vid-group-head';
            const bodyContent = expanded
                ? `<div class="ked-vid-group-body">${vids.map(v => _kedVideoCard(v, weekStartMs, weekEndMs, dayFilter)).join('')}</div>`
                : '';
            return `<div class="ked-vid-group${expanded ? ' is-expanded' : ''}">
                <button type="button" class="${headCls}" onclick="_kasperToggleClient(${_jsAttrArg(editorKey)},${_jsAttrArg(c)})">
                    <svg class="ked-group-chev" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5l4 3.5-4 3.5"/></svg>
                    <span class="ked-group-name">${_calEsc(c)}</span>
                    <span class="ked-vid-group-count">${vids.length}</span>
                    ${summaryHtml}
                </button>
                ${bodyContent}
            </div>`;
        }).join('');

        return `<div class="ked-vid-list">
            ${toolbarHtml}
            <div class="ked-vid-axis">
                <div class="ked-vid-axis-track">${dayLabelsHtml}</div>
            </div>
            ${bodyHtml}
        </div>`;
    }

    function _kedVideoCard(v, weekStartMs, weekEndMs, dayFilter) {
        const segs = _kedBuildSegments(v.transitions || [], weekStartMs, weekEndMs);
        const segHtml = segs.length
            ? segs.map(s => {
                const labelName = _KED_STATUS_LABELS[s.slug] || s.status;
                const style = s.kind === 'work'
                    ? `left:${s.startPct.toFixed(3)}%;width:${s.widthPct.toFixed(3)}%;`
                    : `left:${s.startPct.toFixed(3)}%;`;
                return `<div class="ked-strip-seg" data-status="${s.slug}" data-kind="${s.kind}" data-tip="${_calEscAttr(labelName)}" style="${style}"></div>`;
            }).join('')
            : '';
        const clientHtml = v.clientName
            ? `<div class="ked-vid-client">${_calEsc(v.clientName)}</div>`
            : '';
        const titleHtml = v.url
            ? `<a class="ked-vid-title" href="${_calEscAttr(v.url)}" target="_blank" rel="noopener">${_calEsc(v.title || 'Untitled')}</a>`
            : `<span class="ked-vid-title">${_calEsc(v.title || 'Untitled')}</span>`;
        // Per-video rework: how many times it was sent on for review. Only the
        // grinders (2+) get a badge, so a one-and-done video stays clean.
        const rounds = _kedVideoDeliveries(v).length;
        const roundsHtml = rounds >= 2
            ? `<span class="ked-vid-rounds" data-tip="Sent on for review ${rounds} times last week — it kept coming back for changes.">${rounds} rounds</span>`
            : '';
        return `<article class="ked-vid">
            <div class="ked-vid-meta">
                ${clientHtml}
                ${titleHtml}
                ${roundsHtml}
            </div>
            <div class="ked-vid-strip">
                <div class="ked-strip-track">${segHtml}</div>
            </div>
        </article>`;
    }

    // Editor-tab tooltips (day bars, strip segments, the Load/Deliveries
    // stats) ride the shared global tooltip — see setupGlobalTooltip. The old
    // bespoke .ked-tip handler was removed: it also fired on [data-tip], so
    // every editor tooltip was painting twice (once here, once globally).

    function _kedAvatarFallback(name) {
        const span = document.createElement('span');
        span.textContent = _kedInitials(name);
        return span;
    }

    function _kasperToggleEditor(key) {
        const wasOpen = !!_kasperState.editorsExpanded[key];
        _kasperState.editorsExpanded[key] = !wasOpen;
        if (wasOpen) _kasperState.editorsDayFilter[key] = null;
        _kedPaint();
    }
    function _kasperToggleEditorDay(key, dayKey) {
        const current = _kasperState.editorsDayFilter[key] || null;
        if (current === dayKey) {
            // Clicking the same day twice clears the filter (stays expanded).
            _kasperState.editorsDayFilter[key] = null;
        } else {
            _kasperState.editorsDayFilter[key] = dayKey;
            _kasperState.editorsExpanded[key] = true;
        }
        // Switching between whole-week and day-filter views resets the
        // per-client expanded state so each view starts at its natural
        // default (whole-week → all expanded; day-filter → all collapsed
        // with summary chips).
        _kasperState.editorsClientExpanded[key] = {};
        _kedPaint();
    }
    function _kasperClearEditorDay(key) {
        _kasperState.editorsDayFilter[key] = null;
        _kasperState.editorsClientExpanded[key] = {};
        _kedPaint();
    }
    function _kasperToggleClient(editorKey, clientName) {
        const inDayFilter = !!_kasperState.editorsDayFilter[editorKey];
        const defaultExpanded = !inDayFilter;
        const ed = _kasperState.editorsClientExpanded[editorKey] = _kasperState.editorsClientExpanded[editorKey] || {};
        const curr = (clientName in ed) ? ed[clientName] : defaultExpanded;
        ed[clientName] = !curr;
        _kedPaint();
    }
    function _kasperToggleAllClients(editorKey) {
        const data = _kasperState.editorsData;
        if (!data) return;
        const ed = (data.editors || []).find(e => (e.email || e.name) === editorKey);
        if (!ed) return;
        const inDayFilter = !!_kasperState.editorsDayFilter[editorKey];
        const defaultExpanded = !inDayFilter;
        const filtered = inDayFilter
            ? (ed.videos || []).filter(v => _kedVideoContributedOnDay(v, _kasperState.editorsDayFilter[editorKey]))
            : (ed.videos || []);
        const clients = Array.from(new Set(filtered.map(v => v.clientName || 'No client')));
        const explicit = _kasperState.editorsClientExpanded[editorKey] || {};
        const allExpanded = clients.every(c => (c in explicit) ? explicit[c] : defaultExpanded);
        const next = {};
        for (const c of clients) next[c] = !allExpanded;
        _kasperState.editorsClientExpanded[editorKey] = next;
        _kedPaint();
    }

    // Expose handlers called from inline HTML.
    window._kasperGotoTab = _kasperGotoTab;
    window._kasperLoadReview = _kasperLoadReview;
    window._kasperToggleCard = _kasperToggleCard;
    window._kasperApproveComp = _kasperApproveComp;
    window._kasperRequestTweakComp = _kasperRequestTweakComp;
    window._kasperAddCommentComp = _kasperAddCommentComp;
    window._kasperApproveAfterTweaksComp = _kasperApproveAfterTweaksComp;
    window._kasperOnPanelDraftInput = _kasperOnPanelDraftInput;
    window._kasperDismiss = _kasperDismiss;
    window._kasperClose = _kasperClose;
    window._kasperMarkRepliesRead = _kasperMarkRepliesRead;
    window._kasperRepliesReply = _kasperRepliesReply;
    window._kasperRepliesToggleAll = _kasperRepliesToggleAll;
    window._kasperRepliesDraftInput = _kasperRepliesDraftInput;
    window._kasperOpenLightbox = _kasperOpenLightbox;
    window._kasperCloseLightbox = _kasperCloseLightbox;
    window._kasperToggleHistory = _kasperToggleHistory;
    window._kasperHistoryThumbFallback = _kasperHistoryThumbFallback;
    window._kasperLoadEditors = _kasperLoadEditors;
    window._kasperToggleEditor = _kasperToggleEditor;
    window._kasperToggleEditorDay = _kasperToggleEditorDay;
    window._kasperClearEditorDay = _kasperClearEditorDay;
    window._kasperToggleClient = _kasperToggleClient;
    window._kasperToggleAllClients = _kasperToggleAllClients;
    window._kedAvatarFallback = _kedAvatarFallback;
    window._kedToggleInfo = _kedToggleInfo;
    window._kasperSetEditorsAvg = _kasperSetEditorsAvg;

    // Kasper (310-340, and its sales intake and hiring pages) is an on-demand
    // area; this is its last fragment, so everything it names has run by now.
    // Outside code reaches it through here (040 svAreaApi / svArea / svWithArea)
    // or through the stand-ins in core 305.
    svAreaRegister('kasper', {
        render: renderKasperView,
        mount: mountKasperView,
        teardown: _kasperTeardown,
        staffPageShell: _svStaffPageShell,
        staffPageRender: _svStaffPageRender,
        renderTab: _kasperRenderTab,
        restorePendingSubtab: _kasperRestorePendingSubtab,
        renderOnboarding: _kasperRenderOnboarding,
        loadFilming: _kasperLoadFilming,
        paintReview: _kasperPaintReviewNow,
        openLightbox: _kasperOpenLightboxNow,
        gotoTab: _kasperGotoTabNow,
        fallbackToReview: _kasperFallbackToReviewNow,
        ccOpenModal: _ccOpenModalNow,
        // Sign-out / identity change: drop every credential, hiring and client
        // record this area holds, and close anything showing them.
        purgeSensitiveState() {
            try { _hpPurgeSensitiveState(); } catch (e) {}
            try { _caPurgeSensitiveState(); } catch (e) {}
            try { _ccCloseModal(); } catch (e) {}
            try { _ccRevTeardown(); } catch (e) {}
            try {
                _ccState.kasper.credentials = [];
                _ccState.kasper.error = null;
                _ccState.kasper.loaded = false;
                _ccState.kasper.loading = false;
                _ccState.modal.credentials = [];
                _ccState.modal.error = null;
                _ccState.modal.loaded = false;
                _ccState.modal.loading = false;
                _ccState.modal.open = false;
                _ccState.modal.client = '';
            } catch (e) {}
            try { _ccRevealed.clear(); } catch (e) {}
            try { _ccExpanded.clear(); } catch (e) {}
        },
    });

;(self.__svParts || (self.__svParts = [])).push("js/sv-16-kasper-2131b8f19968.js");
