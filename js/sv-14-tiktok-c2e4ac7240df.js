const TK_PRIVACY_LEVELS=[{v:"PUBLIC_TO_EVERYONE",label:"Public"},{v:"SELF_ONLY",label:"Private (only me)"}],TK_POST_MODES=[{v:"DIRECT_POST",label:"Direct post"},{v:"MEDIA_UPLOAD",label:"Send to TikTok drafts"}],TK_TIMEZONES=["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Anchorage","Pacific/Honolulu","Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid","Asia/Dubai","Asia/Singapore","Asia/Tokyo","Australia/Sydney","UTC"],TK_QUEUE_PAGE=5,tkState={client:null,profile:null,profileSource:null,mediaType:"video",file:null,fileMeta:null,objectUrl:null,photos:[],photosMeta:null,title:"",options:{privacy_level:"PUBLIC_TO_EVERYONE",post_mode:"DIRECT_POST",cover_timestamp_ms:1e3,disable_duet:!1,disable_comment:!1,disable_stitch:!1,brand_content_toggle:!1,brand_organic_toggle:!1,is_aigc:!1,auto_add_music:!0},schedule:{postNow:!0,at:"",tz:"America/New_York"},uploads:[],queueReadState:"loading",queueFailures:0,queueTab:"upcoming",queueLimit:TK_QUEUE_PAGE,submitting:!1,error:null,progress:0};let _tkPollTimer=null,_tkSaveTimer=null,_tkActiveXhr=null,_tkActivePhotoAbort=null,_tkMounted=!1,_tkVisHooked=!1;const ttpState={client:null,account:null,accounts:{},accountsLoaded:!1,accountsError:null,creatorInfo:null,creatorInfoLoading:!1,creatorInfoError:null,file:null,fileMeta:null,objectUrl:null,durationSec:null,title:"",options:{privacy_level:"",allow_comment:!1,allow_duet:!1,allow_stitch:!1,commercial:!1,your_brand:!1,branded_content:!1,cover_timestamp_ms:1e3},uploads:[],submitting:!1,error:null,progress:0};let _ttpPollTimer=null,_ttpSaveTimer=null,_ttpActiveXhr=null,_ttpMounted=!1,_ttpVisHooked=!1;function _tkInjectCSSOnce(){if(document.getElementById("tkUploadStyles"))return;const e=document.createElement("style");e.id="tkUploadStyles",e.textContent=`
        .tk-page { max-width: 1240px; margin: 0 auto; padding: 24px 32px 80px; display: grid; grid-template-columns: minmax(0, 1fr) 360px; grid-template-rows: auto 1fr; gap: 24px; align-items: start; }
        .tk-header { grid-column: 1; grid-row: 1; display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .tk-form-col { grid-column: 1; grid-row: 2; }
        .tk-right-col { grid-column: 2; grid-row: 1 / span 2; }
        /* Collapse to a single stacked column on narrow screens. This block must
           come AFTER the base column-placement rules above: it has the same
           selector specificity, so it only wins on source order. When it lived
           before them, the unconditional right-column rule (grid-column 2)
           always overrode the override — the layout never collapsed, the right
           column forced an implicit 2nd track, and the form column (with the
           upload drop zone) got squeezed to a ~85px sliver on phones. */
        @media (max-width: 1024px) {
            .tk-page { grid-template-columns: 1fr; grid-template-rows: auto; }
            .tk-header { grid-column: 1; grid-row: 1; }
            .tk-form-col { grid-column: 1; grid-row: 2; }
            .tk-right-col { grid-column: 1; grid-row: 3; }
        }
        .tk-title { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.01em; color: var(--text-primary); }
        .tk-sub { font-size: 0.86rem; color: var(--text-secondary); margin-top: 2px; }
        .tk-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .tk-card { background: var(--white); border: 1px solid var(--border); border-radius: 14px; padding: 20px 22px; }
        /* Form column: numbered steps on a thin rail instead of boxed cards. */
        #tkFormCol { counter-reset: tkstep; }
        #tkFormCol > .tk-card { background: none; border: 0; border-radius: 0; padding: 0 0 26px 40px; position: relative; counter-increment: tkstep; }
        #tkFormCol > .tk-card::before { content: counter(tkstep); position: absolute; left: 0; top: -3px; width: 24px; height: 24px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--border); display: grid; place-items: center; font-size: 0.72rem; font-weight: 700; color: var(--text-secondary); background: var(--bg); }
        #tkFormCol > .tk-card::after { content: ""; position: absolute; left: 11px; top: 26px; bottom: 6px; width: 1.5px; background: var(--border); }
        #tkFormCol > .tk-opts-card::after { display: none; }
        .tk-step-note { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; }
        .tk-radio-row.tk-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 0; background: var(--field-bg); border-radius: 12px; padding: 4px; }
        .tk-seg .tk-radio { justify-content: center; border: 0; border-radius: 9px; padding: 10px; background: none; }
        .tk-seg .tk-radio:hover { color: var(--text-primary); }
        .tk-seg .tk-radio.active { background: var(--text-primary); color: var(--white); }
        .tk-sched-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        #tkFormCol .tk-sched-head h3 { margin: 0; }
        #tkScheduleFields { margin-top: 14px; }
        .tk-opts-head { all: unset; box-sizing: border-box; width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; cursor: pointer; }
        .tk-opts-head:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 4px; border-radius: 6px; }
        #tkFormCol .tk-opts-head h3 { margin: 0; }
        .tk-opts-more { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 700; color: var(--text-primary); white-space: nowrap; }
        .tk-opts-more svg { transition: transform 0.15s; }
        .tk-opts-head[aria-expanded="true"] .tk-opts-more svg { transform: rotate(180deg); }
        .tk-opts-body { margin-top: 16px; }
        .tk-card h3 { margin: 0 0 14px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
        .tk-card h3 .tk-card-hint { float: right; text-transform: none; letter-spacing: 0; font-weight: 600; color: var(--text-secondary); font-size: 0.74rem; }
        .tk-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .tk-row:last-child { margin-bottom: 0; }
        .tk-row label { font-size: 0.74rem; font-weight: 700; color: var(--text-secondary); }
        .tk-row .tk-help { font-size: 0.72rem; color: var(--text-muted); }
        .tk-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 640px) { .tk-grid-2 { grid-template-columns: 1fr; } }
        .tk-select { width: 100%; border: 1.5px solid transparent; background: var(--bg); border-radius: 8px; padding: 10px 12px; font-family: inherit; font-size: 0.88rem; color: var(--text-primary); outline: none; cursor: pointer; transition: border-color 0.13s, background 0.13s; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
        .tk-select:hover { background-color: var(--sv-bg-ededea); }
        .tk-select:focus { border-color: var(--text-primary); background-color: var(--white); }
        .tk-profile-line { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px; }
        .tk-profile-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; background: var(--bg); border-radius: 99px; font-weight: 600; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.74rem; }
        .tk-warn-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; background: var(--sv-bg-fef3c7); color: var(--sv-fg-92400e); border-radius: 99px; font-weight: 700; font-size: 0.72rem; }
        .tk-drop { position: relative; border: 1.8px dashed var(--border); border-radius: 12px; padding: 28px 20px; text-align: center; cursor: pointer; transition: all 0.15s; background: var(--bg); }
        .tk-drop:hover, .tk-drop.tk-drag { border-color: var(--text-primary); background: var(--white); }
        .tk-drop input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .tk-drop-icon { width: 36px; height: 36px; margin: 0 auto 10px; display: grid; place-items: center; border-radius: 50%; background: var(--white); border: 1px solid var(--border); }
        .tk-drop-title { font-size: 0.92rem; font-weight: 700; color: var(--text-primary); }
        .tk-drop-sub { font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px; }
        .tk-file-card { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); }
        .tk-file-card video { width: 100%; max-width: 320px; aspect-ratio: 9 / 16; border-radius: 10px; background: var(--sv-bg-000); object-fit: contain; }
        .tk-file-meta { width: 100%; min-width: 0; display: flex; align-items: center; gap: 12px; }
        .tk-file-meta-text { flex: 1; min-width: 0; }
        .tk-file-name { font-size: 0.9rem; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tk-file-size { font-size: 0.76rem; color: var(--text-secondary); margin-top: 4px; }
        .tk-file-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .tk-mini-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; background: var(--white); border: 1px solid var(--border); border-radius: 7px; font-family: inherit; font-size: 0.74rem; font-weight: 600; color: var(--text-secondary); cursor: pointer; transition: all 0.13s; }
        .tk-mini-btn:hover { color: var(--text-primary); border-color: var(--sv-border-aaa); }
        .tk-counter { font-size: 0.7rem; color: var(--text-muted); text-align: right; margin-top: 4px; }
        .tk-counter.over { color: var(--sv-fg-dc2626); font-weight: 700; }
        .tk-toggles { display: flex; flex-wrap: wrap; gap: 18px 24px; }
        .tk-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 0.82rem; color: var(--text-primary); font-weight: 600; position: relative; }
        .tk-toggle input { position: absolute; opacity: 0; pointer-events: none; }
        .tk-toggle-track { position: relative; width: 30px; height: 16px; border-radius: 8px; background: var(--border); transition: background 0.15s; flex-shrink: 0; }
        .tk-toggle-thumb { position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%; background: var(--white); transition: left 0.15s; box-shadow: 0 1px 2px var(--sv-shadow-rgba-0-0-0-0_18); }
        .tk-toggle input:checked ~ .tk-toggle-track { background: var(--text-primary); }
        .tk-toggle input:checked ~ .tk-toggle-track .tk-toggle-thumb { left: 15px; }
        .tk-radio-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .tk-radio { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border: 1.5px solid var(--border); border-radius: 99px; cursor: pointer; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); background: var(--white); transition: all 0.13s; }
        /* Visually hidden, not display:none — a display:none input drops out of the tab
           order entirely, which made every .tk-radio group (including the new Video /
           Photo carousel toggle) unreachable by keyboard. This keeps it focusable and
           announced by screen readers while looking identical for mouse/touch. */
        .tk-radio input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        .tk-radio:hover { border-color: var(--sv-border-aaa); color: var(--text-primary); }
        .tk-radio:focus-within { outline: 2px solid var(--text-primary); outline-offset: 2px; }
        .tk-radio.active { background: var(--text-primary); color: var(--white); border-color: var(--text-primary); }
        .tk-submit-bar { display: flex; align-items: center; gap: 14px; padding: 14px 22px; background: var(--white); border: 1px solid var(--border); border-radius: 14px; position: sticky; bottom: 16px; box-shadow: 0 6px 24px var(--sv-shadow-rgba-0-0-0-0_06); }
        .tk-submit-btn { flex-shrink: 0; padding: 12px 28px; background: var(--text-primary); color: var(--white); border: none; border-radius: 10px; font-family: inherit; font-size: 0.9rem; font-weight: 700; cursor: pointer; transition: opacity 0.15s; }
        .tk-submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .tk-submit-btn:not(:disabled):hover { opacity: 0.88; }
        .tk-progress { flex: 1; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
        .tk-progress-bar { height: 100%; background: var(--text-primary); width: 0%; transition: width 0.2s; }
        .tk-error { color: var(--sv-fg-dc2626); font-size: 0.82rem; font-weight: 600; }
        .tk-client-search .search-bar-pill { width: 100%; box-sizing: border-box; }
        .tk-client-search .search-suggestion.active { background: var(--bg); color: var(--text-primary); }
        .tk-q-tabs { display: flex; gap: 4px; padding: 3px; background: var(--bg); border-radius: 10px; margin-bottom: 6px; }
        .tk-q-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; font-family: inherit; font-size: 0.74rem; font-weight: 700; color: var(--text-secondary); cursor: pointer; }
        .tk-q-tab:hover { color: var(--text-primary); }
        .tk-q-tab.on { background: var(--white); color: var(--text-primary); box-shadow: 0 1px 3px var(--sv-shadow-rgba-0-0-0-0_1); }
        .tk-q-tab b { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--border); font-size: 0.64rem; }
        .tk-q-tab.alert b { background: var(--sv-bg-fee2e2); color: var(--sv-fg-991b1b); }
        .tk-q-tab:focus-visible, .tk-q-btn:focus-visible, .tk-q-more:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
        .tk-queue-item { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 4px 12px; align-items: start; padding: 12px 2px; border-top: 1px solid var(--border); }
        .tk-q-tabs + .tk-queue-item { border-top: 0; }
        .tk-q-when { text-align: center; line-height: 1.15; }
        .tk-q-day { font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
        .tk-q-time { font-size: 0.88rem; font-weight: 800; color: var(--text-primary); margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .tk-q-main { min-width: 0; }
        .tk-queue-client { font-size: 0.84rem; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tk-queue-title { font-size: 0.76rem; color: var(--text-secondary); margin: 2px 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tk-q-meta { display: flex; gap: 10px; align-items: center; font-size: 0.7rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; }
        .tk-st { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; flex-shrink: 0; }
        .tk-st::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
        .tk-st.scheduled { color: var(--sv-fg-92400e); }
        .tk-st.queued, .tk-st.cancelled, .tk-st.canceled { color: var(--text-secondary); }
        .tk-st.uploading, .tk-st.processing { color: var(--sv-fg-1e40af); }
        .tk-st.posted { color: var(--sv-fg-065f46); }
        .tk-st.failed { color: var(--sv-fg-dc2626); }
        .tk-st.noresult { color: var(--sv-fg-92400e); }
        .tk-queue-actions { grid-column: 2; display: flex; gap: 6px; align-items: center; margin-top: 4px; }
        .tk-q-when { padding-top: 2px; }
        .tk-q-day { white-space: nowrap; }
        .tk-q-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--white); color: var(--text-secondary); font-family: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }
        .tk-q-btn:hover { color: var(--text-primary); border-color: var(--sv-border-aaa); }
        .tk-q-danger { color: var(--sv-fg-dc2626); }
        /* Row actions: plain text, no box, shown on hover (always on touch screens). */
        .tk-queue-item { position: relative; }
        .tk-queue-actions { position: absolute; right: 0; top: 50%; transform: translateY(-50%); margin: 0; gap: 14px; opacity: 0; transition: opacity 0.15s; }
        .tk-queue-item:hover .tk-queue-actions, .tk-queue-item:focus-within .tk-queue-actions { opacity: 1; }
        .tk-queue-actions .tk-q-btn { border: 0; background: none; min-height: 0; padding: 4px; width: auto; color: var(--text-secondary); font-weight: 500; }
        .tk-queue-actions .tk-q-btn:hover { color: var(--text-primary); text-decoration: underline; border: 0; }
        .tk-queue-actions .tk-q-primary { color: var(--text-primary); font-weight: 600; }
        @media (hover: none), (max-width: 640px) {
            .tk-queue-actions { opacity: 1; position: static; transform: none; grid-column: 2; margin-top: 4px; }
            .tk-queue-actions .tk-q-btn { min-height: 40px; padding: 0 6px; }
        }
        .tk-submit-bar .tk-mini-btn { border: 0; background: none; padding: 4px; }
        .tk-q-primary { background: var(--text-primary); color: var(--white); border-color: var(--text-primary); }
        .tk-q-primary:hover { color: var(--white); opacity: 0.88; }
        .tk-q-x { width: 32px; padding: 0; font-size: 1rem; color: var(--text-muted); }
        .tk-q-more { display: block; width: 100%; margin-top: 8px; min-height: 36px; border: 1px dashed var(--border); border-radius: 10px; background: transparent; font-family: inherit; font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); cursor: pointer; }
        .tk-q-more:hover { color: var(--text-primary); border-color: var(--sv-border-aaa); }
        .tk-q-more span { font-weight: 600; color: var(--text-muted); }
        .tk-queue-empty { padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 0.82rem; }
        .tk-queue-error { font-size: 0.72rem; color: var(--sv-fg-991b1b); margin-top: 6px; padding: 6px 8px; background: var(--sv-bg-fee2e2); border-radius: 6px; white-space: normal; }
        @media (max-width: 640px) {
            .tk-q-btn, .tk-q-tab { min-height: 40px; }
            .tk-q-x { width: 40px; }
        }
        .tk-time-row { display: flex; align-items: center; gap: 8px; }
        .tk-time-select { width: auto; min-width: 64px; padding-right: 26px; flex-shrink: 0; }
        .tk-time-sep { font-weight: 700; color: var(--text-secondary); font-size: 1rem; }
        .tk-ampm { display: inline-flex; border: 1.5px solid var(--border); border-radius: 99px; padding: 2px; gap: 2px; background: var(--white); margin-left: 4px; }
        .tk-ampm-btn { padding: 5px 12px; border: none; background: transparent; border-radius: 99px; font-family: inherit; font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); cursor: pointer; transition: all 0.13s; }
        .tk-ampm-btn:hover { color: var(--text-primary); }
        .tk-ampm-btn.active { background: var(--text-primary); color: var(--white); }
        .tk-schedule-preview { margin-top: 14px; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; font-size: 0.84rem; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
        .tk-schedule-preview::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--sv-bg-f59e0b); flex-shrink: 0; }
        .tk-preview-card { background: var(--white); border: 1px solid var(--border); border-radius: 14px; padding: 16px 16px 18px; }
        .tk-preview-card h3 { margin: 0 0 12px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
        .tk-preview-frame { position: relative; aspect-ratio: 9 / 16; background: var(--sv-bg-000); border-radius: 18px; overflow: hidden; max-width: 260px; margin: 0 auto; box-shadow: 0 8px 24px var(--sv-shadow-rgba-0-0-0-0_18); }
        .tk-preview-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .tk-preview-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--sv-fg-aaa); font-size: 0.78rem; padding: 24px 56px; text-align: center; background: linear-gradient(135deg, var(--sv-bg-222), var(--sv-bg-000)); }
        /* 56px on both sides: the action rail (avatar "?", like, comment, share) sits at right: 8px and is ~34px wide, so 24px let it cover the end of the placeholder line. Symmetric so the text stays centred. */
        .tk-preview-gradient { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to top, var(--sv-bg-rgba-0-0-0-0_55) 0%, var(--sv-bg-rgba-0-0-0-0) 35%, var(--sv-bg-rgba-0-0-0-0) 78%, var(--sv-misc-rgba-0-0-0-0_35) 100%); }
        .tk-preview-topbar { position: absolute; top: 10px; left: 0; right: 0; display: flex; justify-content: center; gap: 18px; font-size: 0.72rem; font-weight: 700; color: var(--sv-fg-rgba-255-255-255-0_7); }
        .tk-preview-topbar .active { color: var(--sv-fg-fff); border-bottom: 2px solid var(--sv-border-fff); padding-bottom: 2px; }
        .tk-preview-icons { position: absolute; right: 8px; bottom: 76px; display: flex; flex-direction: column; align-items: center; gap: 14px; color: var(--sv-fg-fff); }
        .tk-preview-icon { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 0.66rem; font-weight: 700; text-shadow: 0 1px 3px var(--sv-shadow-rgba-0-0-0-0_55); }
        .tk-preview-icon svg { filter: drop-shadow(0 1px 2px var(--sv-shadow-rgba-0-0-0-0_5)); }
        .tk-preview-pic { width: 34px; height: 34px; border-radius: 50%; background: var(--sv-bg-fff); color: var(--sv-fg-000); display: grid; place-items: center; font-weight: 800; font-size: 0.85rem; border: 1.5px solid var(--sv-border-fff); box-shadow: 0 1px 3px var(--sv-shadow-rgba-0-0-0-0_3); }
        .tk-preview-pic-plus { position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); width: 14px; height: 14px; border-radius: 50%; background: var(--sv-bg-fe2c55); color: var(--sv-fg-fff); font-size: 0.65rem; font-weight: 800; display: grid; place-items: center; }
        .tk-preview-text { position: absolute; left: 12px; right: 56px; bottom: 30px; color: var(--sv-fg-fff); }
        .tk-preview-handle { font-size: 0.84rem; font-weight: 800; margin-bottom: 4px; text-shadow: 0 1px 3px var(--sv-shadow-rgba-0-0-0-0_55); }
        .tk-preview-caption { font-size: 0.74rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; text-shadow: 0 1px 3px var(--sv-shadow-rgba-0-0-0-0_55); white-space: pre-wrap; word-break: break-word; }
        .tk-preview-caption-empty { font-style: italic; opacity: 0.55; }
        .tk-preview-music { position: absolute; left: 12px; right: 56px; bottom: 10px; font-size: 0.66rem; color: var(--sv-fg-rgba-255-255-255-0_92); display: flex; align-items: center; gap: 5px; text-shadow: 0 1px 3px var(--sv-shadow-rgba-0-0-0-0_55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tk-preview-meta { margin-top: 12px; padding: 10px 12px; background: var(--bg); border-radius: 8px; font-size: 0.72rem; color: var(--text-secondary); display: flex; justify-content: space-between; gap: 8px; }
        .tk-preview-meta-private { color: var(--sv-fg-92400e); font-weight: 700; }
        html[data-theme="dark"] .tk-select,
        html[data-theme="dark"] .tk-drop,
        html[data-theme="dark"] .tk-file-card,
        html[data-theme="dark"] .tk-profile-chip,
        html[data-theme="dark"] .tk-schedule-preview,
        html[data-theme="dark"] .tk-preview-meta { background: var(--field-bg); }
        html[data-theme="dark"] .tk-select:hover,
        html[data-theme="dark"] .tk-drop:hover,
        html[data-theme="dark"] .tk-drop.tk-drag { background: var(--field-bg-hover); }
        html[data-theme="dark"] .tk-select:focus { border-color: var(--field-border-focus); background-color: var(--field-bg-focus); }
        html[data-theme="dark"] .tk-toggle-thumb { background: var(--text-secondary); }
        html[data-theme="dark"] .tk-toggle input:checked ~ .tk-toggle-track .tk-toggle-thumb { background: var(--white); }
        html[data-theme="dark"] .tk-progress { background: var(--upload-progress-track); }
        html[data-theme="dark"] .tk-progress-bar { background: var(--upload-progress-fill); box-shadow: 0 0 14px var(--upload-progress-glow); }
        .tk-photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin-bottom: 12px; }
        .tk-photo-item { position: relative; aspect-ratio: 3 / 4; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); background: var(--bg); }
        .tk-photo-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .tk-photo-badge { position: absolute; top: 6px; left: 6px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: var(--sv-bg-rgba-0-0-0-0_55); color: var(--sv-fg-fff); font-size: 0.64rem; font-weight: 800; display: grid; place-items: center; }
        .tk-photo-actions { position: absolute; inset-inline: 0; bottom: 0; display: flex; gap: 4px; padding: 6px; background: linear-gradient(to top, var(--sv-bg-rgba-0-0-0-0_55), transparent); opacity: 0; transition: opacity 0.13s; }
        .tk-photo-item:hover .tk-photo-actions, .tk-photo-item:focus-within .tk-photo-actions { opacity: 1; }
        /* Hover-to-reveal has no equivalent on touch — a tap would focus and activate an
           unseen button in one gesture — so keep the strip visible whenever the device has
           no real hover capability, per UI_DESIGN_STANDARDS.md's keyboard/mobile-states rule. */
        @media (hover: none) { .tk-photo-actions { opacity: 1; } }
        /* Full 44px per UI_DESIGN_STANDARDS.md: width is what three controls must share in one
           thumbnail, but height has no such constraint — making the strip taller only covers
           more of the image vertically, so there's no reason to fall short of the target here. */
        .tk-photo-btn { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 44px; border: none; border-radius: 5px; background: var(--white); color: var(--text-primary); font-size: 0.76rem; font-weight: 700; padding: 3px 0; cursor: pointer; }
        .tk-photo-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .tk-photo-btn-remove { color: var(--sv-fg-dc2626); }
        `,document.head.appendChild(e)}function _tkResolveProfile(e){if(!e)return{profile:null,source:null};const t=(clientMap[e]?.postforme_account_id||"").trim();return t?{profile:t,source:"sheet"}:{profile:null,source:"missing"}}function _tkFormatBytes(e){if(!Number.isFinite(e)||e<=0)return"0 B";const t=["B","KB","MB","GB"];let o=0;for(;e>=1024&&o<t.length-1;)e/=1024,o++;return`${e.toFixed(o===0?0:1).replace(/\.0$/,"")} ${t[o]}`}function _tkEscape(e){return String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function _tkParseAt(e){const t=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(e||"");if(!t)return{date:"",hour12:"",minute:"",ampm:"AM"};let o=parseInt(t[2],10);const r=o>=12?"PM":"AM";return o=o%12||12,{date:t[1],hour12:String(o),minute:t[3],ampm:r}}function _tkComposeAt(e){if(!e.date||e.hour12===""||e.hour12==null||e.minute===""||e.minute==null)return"";let t=parseInt(e.hour12,10);return Number.isFinite(t)?(e.ampm==="PM"&&t<12&&(t+=12),e.ampm==="AM"&&t===12&&(t=0),`${e.date}T${String(t).padStart(2,"0")}:${String(e.minute).padStart(2,"0")}`):""}function _tkFormatScheduledLong(e,t){const o=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(e||"");if(!o)return"";const r=new Date(+o[1],+o[2]-1,+o[3],+o[4],+o[5]);if(Number.isNaN(r.getTime()))return"";const s=r.toLocaleString(void 0,{weekday:"long",month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});return t?`${s} · ${t}`:s}function _tkFormatQueueWhen(e,t){if(!e)return"";const o={weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"};if(/Z$|[+\-]\d{2}:?\d{2}$/.test(e))try{return new Date(e).toLocaleString(void 0,{...o,timeZone:t||void 0})}catch{return new Date(e).toLocaleString(void 0,o)}const r=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(e);return r?new Date(+r[1],+r[2]-1,+r[3],+r[4],+r[5]).toLocaleString(void 0,o):e}function _tkUpdateSchedulePreview(){const e=document.getElementById("tkSchedulePreview");if(!e)return;const t=_tkFormatScheduledLong(tkState.schedule.at,tkState.schedule.tz);t?(e.textContent=t,e.style.display=""):(e.textContent="",e.style.display="none")}function _tkWallClockToUTC(e,t){const o=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(e||"");if(!o||!t)return null;const r=+o[1],s=+o[2],a=+o[3],n=+o[4],i=+o[5],d=Date.UTC(r,s-1,a,n,i);try{const h=new Intl.DateTimeFormat("en-US",{timeZone:t,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}),m=Object.fromEntries(h.formatToParts(new Date(d)).map(g=>[g.type,g.value])),f=Date.UTC(+m.year,+m.month-1,+m.day,+m.hour,+m.minute,+m.second);return new Date(d-(f-d)).toISOString()}catch{return null}}const TK_PRIVACY_LABELS={PUBLIC_TO_EVERYONE:"Public",SELF_ONLY:"Private"};function _tkRenderPreview(){const e=document.getElementById("tkPreviewWrap");if(!e)return;const t=(clientMap[tkState.client]?.tiktok_handle||"").trim().replace(/^@+/,""),o=t?"@"+t:tkState.client||"@your_account",r=(tkState.title||"").trim(),s=r.length>2200,a=tkState.mediaType==="photo",n=tkState.objectUrl||"",i=a&&tkState.photos[0]?tkState.photos[0].objectUrl:"",d=(tkState.client||"?").charAt(0).toUpperCase(),h=TK_PRIVACY_LABELS[tkState.options.privacy_level]||"Public",m=tkState.options.privacy_level==="SELF_ONLY",f=tkState.options.post_mode==="MEDIA_UPLOAD"?"Drafts (no auto-post)":"Direct post",g='<svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M12 21s-7-4.5-9.5-9C.5 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6.5 4 4.5 8C19 16.5 12 21 12 21z"/></svg>',l='<svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>',c='<svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M2 12l20-9-7 20-3-9-10-2z"/></svg>',v='<svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M9 17V5l12-2v12"/><circle cx="6" cy="17" r="3"/><circle cx="18" cy="15" r="3"/></svg>';e.innerHTML=`
            <div class="tk-preview-card">
                <h3>Preview <span style="float:right;text-transform:none;letter-spacing:0;font-weight:600;color:var(--text-secondary);font-size:0.72rem">live</span></h3>
                <div class="tk-preview-frame">
                    ${a?i?`<img class="tk-preview-video" id="tkPreviewVideo" src="${_tkEscape(i)}" alt="">`:'<div class="tk-preview-empty">Attach images to see how this post will look on TikTok.</div>':n?`<video class="tk-preview-video" id="tkPreviewVideo" src="${_tkEscape(n)}" autoplay muted loop playsinline></video>`:'<div class="tk-preview-empty">Attach a video to see how this post will look on TikTok.</div>'}
                    <div class="tk-preview-gradient"></div>
                    <div class="tk-preview-topbar">
                        <span>Following</span>
                        <span class="active">For You</span>
                    </div>
                    <div class="tk-preview-icons">
                        <div class="tk-preview-icon" style="position:relative">
                            <div class="tk-preview-pic">${_tkEscape(d)}</div>
                            <div class="tk-preview-pic-plus">+</div>
                        </div>
                        <div class="tk-preview-icon">${g}<span>—</span></div>
                        <div class="tk-preview-icon">${l}<span>—</span></div>
                        <div class="tk-preview-icon">${c}<span>Share</span></div>
                    </div>
                    <div class="tk-preview-text">
                        <div class="tk-preview-handle" id="tkPreviewHandle">${_tkEscape(o)}</div>
                        <div class="tk-preview-caption ${r?"":"tk-preview-caption-empty"}" id="tkPreviewCaption">${r?_tkEscape(r):"Caption will appear here…"}</div>
                    </div>
                    ${a?tkState.options.auto_add_music!==!1?`<div class="tk-preview-music">${v}<span>Music added automatically</span></div>`:"":`<div class="tk-preview-music">${v}<span>Original sound · ${_tkEscape(o)}</span></div>`}
                </div>
                <div class="tk-preview-meta">
                    <span>${_tkEscape(h)}${m?' <span class="tk-preview-meta-private">(only you)</span>':""}</span>
                    <span>${a&&tkState.photos.length?_tkEscape(`${tkState.photos.length} photo${tkState.photos.length===1?"":"s"}`):_tkEscape(f)}</span>
                </div>
                ${s?'<div class="tk-error" style="margin-top:10px">Caption is over the 2200-character limit.</div>':""}
            </div>
        `}function _tkLoadDraft(){try{const e=localStorage.getItem(TIKTOK_FORM_KEY);if(!e)return;const t=JSON.parse(e);t.client&&WL_CLIENT_NAMES.includes(t.client)&&(tkState.client=t.client),typeof t.title=="string"&&(tkState.title=t.title),t.options&&typeof t.options=="object"&&Object.assign(tkState.options,t.options),t.schedule&&typeof t.schedule=="object"&&Object.assign(tkState.schedule,t.schedule),t.fileMeta&&typeof t.fileMeta=="object"&&(tkState.fileMeta=t.fileMeta),(t.mediaType==="photo"||t.mediaType==="video")&&(tkState.mediaType=t.mediaType),Array.isArray(t.photosMeta)&&(tkState.photosMeta=t.photosMeta)}catch(e){console.warn("[SyncView] TikTok draft load error:",e)}}function _tkSaveDraft(){try{const e={client:tkState.client,title:tkState.title,options:tkState.options,schedule:tkState.schedule,fileMeta:tkState.file?{name:tkState.file.name,size:tkState.file.size,type:tkState.file.type}:tkState.fileMeta,mediaType:tkState.mediaType,photosMeta:tkState.photos.length?tkState.photos.map(t=>({name:t.file.name,size:t.file.size,type:t.file.type})):tkState.photosMeta};localStorage.setItem(TIKTOK_FORM_KEY,JSON.stringify(e))}catch{}}function _tkSaveDraftSoon(){clearTimeout(_tkSaveTimer),_tkSaveTimer=setTimeout(_tkSaveDraft,400)}function _tkClearDraft(){try{localStorage.removeItem(TIKTOK_FORM_KEY)}catch{}tkState.fileMeta=null,tkState.photosMeta=null}function _tkLoadPending(){try{return JSON.parse(localStorage.getItem(TIKTOK_PENDING_KEY)||"[]")}catch{return[]}}function _tkSavePending(e){try{localStorage.setItem(TIKTOK_PENDING_KEY,JSON.stringify(e.slice(0,50)))}catch{}}function _tkLoadHidden(){try{return new Set(JSON.parse(localStorage.getItem(TIKTOK_HIDDEN_KEY)||"[]"))}catch{return new Set}}function _tkSaveHidden(e){try{localStorage.setItem(TIKTOK_HIDDEN_KEY,JSON.stringify([...e].slice(0,200)))}catch{}}function _tkPrunePending(e){const t=Date.now()-TIKTOK_OPTIMISTIC_TTL_MS;return e.filter(o=>{if(!o.optimistic)return!0;const r=Date.parse(o.created_at||"");return!Number.isFinite(r)||r>t})}function _tkEffectiveStatus(e){const t=String(e.status||"").toLowerCase()||"queued";if(!_tkIsOverdue(e))return t;const o=(tkState.pfm||{})[e.id];return o&&o.state==="posted"?"posted":o&&o.state==="failed"?"failed":"noresult"}const TK_OVERDUE_MS=3*36e5;function _tkIsOverdue(e){if(e.optimistic)return!1;const t=String(e.status||"").toLowerCase()||"queued";if(!TK_UPCOMING.includes(t))return!1;const o=Date.parse(e.scheduled_for||e.created_at||"");return Number.isFinite(o)&&Date.now()-o>TK_OVERDUE_MS}function renderTiktokUploadView(){return _tkInjectCSSOnce(),`
            <div class="tk-page">
                <div class="tk-header">
                    <div>
                        <div class="tk-title">TikTok Upload</div>
                        <div class="tk-sub">Schedule a TikTok post for a client — uploads through Post For Me.</div>
                    </div>
                </div>
                <div class="tk-col tk-form-col" id="tkFormCol"></div>
                <div class="tk-col tk-right-col">
                    <div class="tk-preview-wrap" id="tkPreviewWrap"></div>
                    <div id="tkQueueCol"></div>
                </div>
            </div>
        `}function _tkOptionsSummary(e){const t=[(TK_PRIVACY_LEVELS.find(r=>r.v===e.privacy_level)||TK_PRIVACY_LEVELS[0]).label,(TK_POST_MODES.find(r=>r.v===e.post_mode)||TK_POST_MODES[0]).label];tkState.mediaType==="video"?t.push(`Cover at ${Math.round((Number(e.cover_timestamp_ms)||0)/100)/10} s`):t.push(e.auto_add_music!==!1?"Auto music on":"Auto music off");const o=[e.disable_comment&&"comments",e.disable_duet&&"duet",e.disable_stitch&&"stitch"].filter(Boolean);return t.push(o.length===0?"Comments, duet, stitch on":o.length===3?"Comments, duet, stitch off":`${o.join(", ")} off`),e.brand_content_toggle&&t.push("Branded content"),e.brand_organic_toggle&&t.push("Your brand"),e.is_aigc&&t.push("AI-generated"),t.join(" · ")}function _tkRenderForm(){const e=document.getElementById("tkFormCol");if(!e)return;if(tkState.client){const p=_tkResolveProfile(tkState.client);tkState.profile=p.profile,tkState.profileSource=p.source}const t=_tkClientNames(),o=(tkState.title||"").length,r=o>2200,s=tkState.mediaType==="photo"?tkState.photos.length>0:!!tkState.file,a=!!(tkState.client&&tkState.profile&&s&&tkState.title.trim()&&!r&&!tkState.submitting);let n="";tkState.client&&(tkState.profileSource==="sheet"?n=`<div class="tk-profile-line">Posts to Post For Me account <span class="tk-profile-chip">${_tkEscape(tkState.profile)}</span></div>`:tkState.profileSource==="missing"&&(n=`<div class="tk-profile-line"><span class="tk-warn-chip">⚠ No account</span> Add this client's <code>postforme_account_id</code> — the account's <strong>Connection ID</strong> (<code>spc_…</code>) from Post For Me — to the Clients Info sheet before uploading.</div>`));let i;if(tkState.file)i=`
                <div class="tk-file-card">
                    <video id="tkFilePreview" src="${_tkEscape(tkState.objectUrl)}" playsinline controls preload="metadata"></video>
                    <div class="tk-file-meta">
                        <div class="tk-file-meta-text">
                            <div class="tk-file-name">${_tkEscape(tkState.file.name)}</div>
                            <div class="tk-file-size">${_tkFormatBytes(tkState.file.size)} · ${_tkEscape(tkState.file.type||"video")}</div>
                        </div>
                        <div class="tk-file-actions">
                            <button class="tk-mini-btn" onclick="_tkReplaceFile()" ${tkState.submitting?"disabled":""}>Replace</button>
                            <button class="tk-mini-btn" onclick="_tkClearFile()" ${tkState.submitting?"disabled":""}>Remove</button>
                        </div>
                    </div>
                </div>`;else{const p=tkState.fileMeta?`<div class="tk-drop-sub" style="color:var(--sv-fg-92400e)">Draft restored — please re-attach <strong>${_tkEscape(tkState.fileMeta.name)}</strong> (${_tkFormatBytes(tkState.fileMeta.size)}).</div>`:`<div class="tk-drop-sub">MP4, MOV or WebM · up to ${_tkFormatBytes(TIKTOK_MAX_BYTES)}</div>`;i=`
                <div class="tk-drop" id="tkDrop">
                    <input type="file" id="tkFile" accept="video/mp4,video/quicktime,video/webm,video/*" ${tkState.submitting?"disabled":""}>
                    <div class="tk-drop-icon">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 11V2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 5.5L8 2L11.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11v2.5h12V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </div>
                    <div class="tk-drop-title">Drop a video here, or click to browse</div>
                    ${p}
                </div>`}const d=`
            <div class="tk-drop" id="tkPhotoDrop">
                <input type="file" id="tkPhotoFile" accept="image/jpeg,image/png,image/webp" multiple ${tkState.submitting?"disabled":""}>
                <div class="tk-drop-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 11V2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 5.5L8 2L11.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11v2.5h12V11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="tk-drop-title">${tkState.photos.length?"Drop more images, or click to add":"Drop images here, or click to browse"}</div>
                <div class="tk-drop-sub">JPEG, PNG or WEBP · 1 to ${TIKTOK_MAX_PHOTOS} images, up to ${_tkFormatBytes(TIKTOK_PHOTO_MAX_BYTES)} each</div>
            </div>`,h=!tkState.photos.length&&tkState.photosMeta&&tkState.photosMeta.length?`<div class="tk-drop-sub" style="color:var(--sv-fg-92400e)">Draft restored — please re-attach ${tkState.photosMeta.length} image${tkState.photosMeta.length===1?"":"s"}.</div>`:"",f=`${tkState.photos.length?`
            <div class="tk-photo-grid">
                ${tkState.photos.map((p,w)=>`
                <div class="tk-photo-item">
                    <img src="${_tkEscape(p.objectUrl)}" alt="Image ${w+1}">
                    <div class="tk-photo-badge">${w+1}</div>
                    <div class="tk-photo-actions">
                        <button type="button" class="tk-photo-btn" data-photo-idx="${w}" data-action="move-earlier" onclick="_tkMovePhoto(${w},-1)" ${w===0||tkState.submitting?"disabled":""} title="Move earlier">&larr;</button>
                        <button type="button" class="tk-photo-btn" data-photo-idx="${w}" data-action="move-later" onclick="_tkMovePhoto(${w},1)" ${w===tkState.photos.length-1||tkState.submitting?"disabled":""} title="Move later">&rarr;</button>
                        <button type="button" class="tk-photo-btn tk-photo-btn-remove" data-photo-idx="${w}" data-action="remove" onclick="_tkRemovePhoto(${w})" ${tkState.submitting?"disabled":""} title="Remove">&times;</button>
                    </div>
                </div>`).join("")}
            </div>`:""}${d}${h}`,g=tkState.options,l=tkState.error?`<div class="tk-error" style="margin-bottom:12px">${_tkEscape(tkState.error)}</div>`:"",c=_tkParseAt(tkState.schedule.at),v=[12,1,2,3,4,5,6,7,8,9,10,11],b=["00","05","10","15","20","25","30","35","40","45","50","55"];c.minute&&!b.includes(c.minute)&&b.push(c.minute);const u=new Date,k=`${u.getFullYear()}-${String(u.getMonth()+1).padStart(2,"0")}-${String(u.getDate()).padStart(2,"0")}`,x=_tkFormatScheduledLong(tkState.schedule.at,tkState.schedule.tz);e.innerHTML=`
            <div class="tk-card">
                <h3>Client <span class="tk-card-hint">${t.length} clients</span></h3>
                <div class="tk-row">
                    <div class="tk-client-search search-bar-wrap" id="tkClientWrap">
                        <div class="search-bar-pill">
                            <input class="search-bar-input" id="tkClientInput" type="text" placeholder="Search clients…" value="${_tkEscape(tkState.client||"")}" autocomplete="off" aria-label="Client" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tkClientResults" ${tkState.submitting?"disabled":""}>
                            <div class="search-ghost-overlay" id="tkClientGhost"></div>
                            <button type="button" class="search-bar-icon" id="tkClientIcon" title="Search" aria-label="Search clients" ${tkState.submitting?"disabled":""}>
                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                            </button>
                        </div>
                        <div class="search-dropdown" id="tkClientBox"><div id="tkClientResults" role="listbox"></div></div>
                    </div>
                    ${n}
                </div>
            </div>

            <div class="tk-card">
                <h3>Media</h3>
                <div class="tk-row">
                    <div class="tk-radio-row tk-seg" role="radiogroup" aria-label="Media type">
                        <label class="tk-radio ${tkState.mediaType==="video"?"active":""}">
                            <input type="radio" name="tkMediaType" value="video" ${tkState.mediaType==="video"?"checked":""} ${tkState.submitting?"disabled":""}>
                            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>Video
                        </label>
                        <label class="tk-radio ${tkState.mediaType==="photo"?"active":""}">
                            <input type="radio" name="tkMediaType" value="photo" ${tkState.mediaType==="photo"?"checked":""} ${tkState.submitting?"disabled":""}>
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="currentColor"/></svg>Photo carousel
                        </label>
                    </div>
                </div>
                ${tkState.mediaType==="photo"?f:i}
            </div>

            <div class="tk-card">
                <h3>Caption</h3>
                <div class="tk-row">
                    <label for="tkTitle">Title / caption</label>
                    <textarea class="tpl-textarea" id="tkTitle" placeholder="What this post is about — include hashtags here." rows="4" ${tkState.submitting?"disabled":""}>${_tkEscape(tkState.title)}</textarea>
                    <div class="tk-counter ${r?"over":""}">${o} / 2200</div>
                </div>
            </div>

            <div class="tk-card">
                <div class="tk-sched-head">
                    <h3>Scheduling</h3>
                    <label class="tk-toggle">
                        <input type="checkbox" id="tkPostNow" ${tkState.schedule.postNow?"checked":""}>
                        <span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>
                        Post immediately
                    </label>
                </div>
                ${tkState.schedule.postNow?'<div class="tk-step-note">Posts as soon as you press Post now. Switch off to pick a date and time.</div>':""}
                <div id="tkScheduleFields" ${tkState.schedule.postNow?"hidden":""}>
                    <div class="tk-grid-2">
                        <div class="tk-row">
                            <label for="tkScheduleDate">Date</label>
                            <input class="tpl-input" id="tkScheduleDate" type="date" value="${_tkEscape(c.date)}" min="${_tkEscape(k)}">
                        </div>
                        <div class="tk-row">
                            <label>Time</label>
                            <div class="tk-time-row">
                                <select class="tk-select tk-time-select" id="tkScheduleHour">
                                    ${v.map(p=>`<option value="${p}" ${String(p)===c.hour12?"selected":""}>${p}</option>`).join("")}
                                </select>
                                <span class="tk-time-sep">:</span>
                                <select class="tk-select tk-time-select" id="tkScheduleMin">
                                    ${b.map(p=>`<option value="${p}" ${p===c.minute?"selected":""}>${p}</option>`).join("")}
                                </select>
                                <div class="tk-ampm" id="tkAmpm">
                                    <button type="button" class="tk-ampm-btn ${c.ampm==="AM"?"active":""}" data-ampm="AM">AM</button>
                                    <button type="button" class="tk-ampm-btn ${c.ampm==="PM"?"active":""}" data-ampm="PM">PM</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tk-row" style="margin-top:6px">
                        <label for="tkScheduleTz">Timezone</label>
                        <select class="tk-select" id="tkScheduleTz">
                            ${TK_TIMEZONES.map(p=>`<option value="${p}" ${p===tkState.schedule.tz?"selected":""}>${p}</option>`).join("")}
                        </select>
                    </div>
                    <div class="tk-schedule-preview" id="tkSchedulePreview" style="${x?"":"display:none"}">${_tkEscape(x)}</div>
                </div>
            </div>

            <div class="tk-card tk-opts-card">
                <button type="button" class="tk-opts-head" id="tkOptsToggle" aria-expanded="${tkState.optsOpen?"true":"false"}" aria-controls="tkOptsBody">
                    <span class="tk-opts-text"><h3>TikTok options</h3><span class="tk-step-note">${_tkEscape(_tkOptionsSummary(g))}</span></span>
                    <span class="tk-opts-more"><span id="tkOptsLabel">${tkState.optsOpen?"Hide options":"Show options"}</span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></span>
                </button>
                <div class="tk-opts-body" id="tkOptsBody" ${tkState.optsOpen?"":"hidden"}>
                <div class="tk-grid-2">
                    <div class="tk-row">
                        <label>Privacy level</label>
                        <div class="tk-radio-row">
                            ${TK_PRIVACY_LEVELS.map(p=>`
                                <label class="tk-radio ${g.privacy_level===p.v?"active":""}">
                                    <input type="radio" name="tkPrivacy" value="${p.v}" ${g.privacy_level===p.v?"checked":""}>
                                    ${p.label}
                                </label>`).join("")}
                        </div>
                    </div>
                    <div class="tk-row">
                        <label>Post mode</label>
                        <div class="tk-radio-row">
                            ${TK_POST_MODES.map(p=>`
                                <label class="tk-radio ${g.post_mode===p.v?"active":""}">
                                    <input type="radio" name="tkPostMode" value="${p.v}" ${g.post_mode===p.v?"checked":""}>
                                    ${p.label}
                                </label>`).join("")}
                        </div>
                    </div>
                </div>
                ${tkState.mediaType==="video"?`
                <div class="tk-row">
                    <label for="tkCover">Cover timestamp (ms) <span class="tk-help">— which frame TikTok grabs as the thumbnail.</span></label>
                    <input class="tpl-input" id="tkCover" type="number" min="0" step="100" value="${Number(g.cover_timestamp_ms)||0}">
                </div>`:`
                <div class="tk-row">
                    <label>Music</label>
                    <div class="tk-toggles">
                        <label class="tk-toggle"><input type="checkbox" id="tkAutoMusic" ${g.auto_add_music!==!1?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>Auto-add trending music</label>
                    </div>
                </div>`}
                <div class="tk-row">
                    <label>Interaction</label>
                    <div class="tk-toggles">
                        <label class="tk-toggle"><input type="checkbox" id="tkDuet"    ${g.disable_duet?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>Disable duet</label>
                        <label class="tk-toggle"><input type="checkbox" id="tkDisableComment" ${g.disable_comment?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>Disable comments</label>
                        <label class="tk-toggle"><input type="checkbox" id="tkStitch"  ${g.disable_stitch?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>Disable stitch</label>
                    </div>
                </div>
                <div class="tk-row">
                    <label>Commercial content disclosure</label>
                    <div class="tk-toggles">
                        <label class="tk-toggle"><input type="checkbox" id="tkBrandContent" ${g.brand_content_toggle?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>Branded content</label>
                        <label class="tk-toggle"><input type="checkbox" id="tkBrandOrganic" ${g.brand_organic_toggle?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>Your brand</label>
                        <label class="tk-toggle"><input type="checkbox" id="tkAigc"          ${g.is_aigc?"checked":""}><span class="tk-toggle-track"><span class="tk-toggle-thumb"></span></span>AI-generated</label>
                    </div>
                </div>
                </div>
            </div>

            ${l}

            <div class="tk-submit-bar">
                <button class="tk-submit-btn" id="tkSubmit" ${a?"":"disabled"}>
                    ${tkState.submitting?"Uploading…":tkState.schedule.postNow?"Post now":"Schedule post"}
                </button>
                <div class="tk-progress"><div class="tk-progress-bar" id="tkProgress" style="width:${tkState.progress}%"></div></div>
                ${tkState.submitting?'<button class="tk-mini-btn" onclick="_tkCancelUpload()">Cancel</button>':""}
            </div>
        `,_tkWireFormEvents(),_tkRenderPreview()}function _tkClientNames(){return[...WL_CLIENT_NAMES].sort((e,t)=>e.localeCompare(t))}function _tkPickClient(e){tkState.client=e||null,tkState.client&&svSharedClientNote(tkState.client);const t=_tkResolveProfile(tkState.client);tkState.profile=t.profile,tkState.profileSource=t.source,_tkSaveDraft(),_tkRenderForm()}function _tkWireClientSearch(){const e=document.getElementById("tkClientWrap"),t=document.getElementById("tkClientInput"),o=document.getElementById("tkClientGhost"),r=document.getElementById("tkClientBox"),s=document.getElementById("tkClientResults"),a=document.getElementById("tkClientIcon");if(!e||!t||!r||!s)return;const n=_tkClientNames();let i=0;const d=u=>`data-tk-client-pick="${_tkEscape(u)}" role="option" id="tkClientOpt${i++}" aria-selected="false"`;let h=-1;const m=()=>[...s.querySelectorAll("[data-tk-client-pick]")],f=u=>{const k=m();h=k.length?(u+k.length)%k.length:-1,k.forEach((x,p)=>{x.classList.toggle("active",p===h),x.setAttribute("aria-selected",String(p===h))}),h>=0?(t.setAttribute("aria-activedescendant",k[h].id),k[h].scrollIntoView({block:"nearest"})):t.removeAttribute("aria-activedescendant")},g=()=>{const u=t.value===(tkState.client||"")?"":t.value;i=0,s.innerHTML=clientSearchResultsHtml(u,n,getRecent().filter(k=>n.includes(k)),d),f(-1),o&&(o.innerHTML=clientSearchGhostHtml(u,n))},l=()=>{r.classList.remove("open"),t.setAttribute("aria-expanded","false"),f(-1),o&&(o.innerHTML=""),t.value=tkState.client||"",document.removeEventListener("click",c)},c=u=>{e.contains(u.target)||l()},v=()=>{r.classList.contains("open")||(r.classList.add("open"),t.setAttribute("aria-expanded","true"),setTimeout(()=>document.addEventListener("click",c),0))},b=()=>{const u=clientSearchMatches(t.value,n)[0];return u?(l(),_tkPickClient(u),!0):!1};t.addEventListener("focus",()=>{t.select(),g(),v()}),t.addEventListener("input",()=>{g(),v()}),t.addEventListener("keydown",u=>{if(u.key==="Escape"){l(),t.blur();return}if(u.key==="ArrowDown"||u.key==="ArrowUp"){u.preventDefault(),r.classList.contains("open")||(g(),v()),f(h+(u.key==="ArrowDown"?1:-1));return}if(u.key==="Enter"){u.preventDefault();const k=m()[h];if(k){l(),_tkPickClient(k.getAttribute("data-tk-client-pick"));return}b()}}),a?.addEventListener("click",()=>{b()||(t.focus(),v())}),s.addEventListener("click",u=>{const k=u.target.closest("[data-tk-client-pick]");k&&(l(),_tkPickClient(k.getAttribute("data-tk-client-pick")))})}function _tkWireFormEvents(){const e=i=>document.getElementById(i);_tkWireClientSearch(),document.querySelectorAll("input[name=tkMediaType]").forEach(i=>i.addEventListener("change",d=>{tkState.mediaType=d.target.value,tkState.error=null,_tkSaveDraft(),_tkRenderForm()}));const t=e("tkDrop"),o=e("tkFile");o&&o.addEventListener("change",i=>_tkHandleFile(i.target.files?.[0])),t&&(["dragenter","dragover"].forEach(i=>t.addEventListener(i,d=>{d.preventDefault(),t.classList.add("tk-drag")})),["dragleave","drop"].forEach(i=>t.addEventListener(i,d=>{d.preventDefault(),t.classList.remove("tk-drag")})),t.addEventListener("drop",i=>_tkHandleFile(i.dataTransfer?.files?.[0])));const r=e("tkPhotoDrop"),s=e("tkPhotoFile");s&&s.addEventListener("change",i=>{_tkHandlePhotoFiles(i.target.files),i.target.value=""}),r&&(["dragenter","dragover"].forEach(i=>r.addEventListener(i,d=>{d.preventDefault(),r.classList.add("tk-drag")})),["dragleave","drop"].forEach(i=>r.addEventListener(i,d=>{d.preventDefault(),r.classList.remove("tk-drag")})),r.addEventListener("drop",i=>_tkHandlePhotoFiles(i.dataTransfer?.files))),e("tkTitle")?.addEventListener("input",i=>{tkState.title=i.target.value;const d=document.querySelector(".tk-counter");d&&(d.textContent=`${tkState.title.length} / 2200`,d.classList.toggle("over",tkState.title.length>2200));const h=e("tkSubmit");h&&(h.disabled=!_tkCanSubmit());const m=document.getElementById("tkPreviewCaption");if(m){const f=tkState.title.trim();m.textContent=f||"Caption will appear here…",m.classList.toggle("tk-preview-caption-empty",!f)}_tkSaveDraftSoon()}),document.querySelectorAll("input[name=tkPrivacy]").forEach(i=>i.addEventListener("change",d=>{tkState.options.privacy_level=d.target.value,_tkSaveDraft(),_tkRenderForm()})),document.querySelectorAll("input[name=tkPostMode]").forEach(i=>i.addEventListener("change",d=>{tkState.options.post_mode=d.target.value,_tkSaveDraft(),_tkRenderForm()})),e("tkCover")?.addEventListener("input",i=>{tkState.options.cover_timestamp_ms=Math.max(0,Number(i.target.value)||0),_tkSaveDraftSoon()});const a=(i,d)=>e(i)?.addEventListener("change",h=>{tkState.options[d]=h.target.checked,_tkSaveDraft()});a("tkDuet","disable_duet"),a("tkDisableComment","disable_comment"),a("tkStitch","disable_stitch"),a("tkBrandContent","brand_content_toggle"),a("tkBrandOrganic","brand_organic_toggle"),a("tkAigc","is_aigc"),a("tkAutoMusic","auto_add_music"),e("tkOptsToggle")?.addEventListener("click",()=>{tkState.optsOpen=!tkState.optsOpen;const i=e("tkOptsBody");i&&(i.hidden=!tkState.optsOpen),e("tkOptsToggle").setAttribute("aria-expanded",tkState.optsOpen?"true":"false"),e("tkOptsLabel").textContent=tkState.optsOpen?"Hide options":"Show options"}),e("tkPostNow")?.addEventListener("change",i=>{tkState.schedule.postNow=i.target.checked,_tkSaveDraft(),_tkRenderForm()});const n=()=>{const i=e("tkScheduleDate")?.value||"",d=e("tkScheduleHour")?.value||"",h=e("tkScheduleMin")?.value||"",m=document.querySelector("#tkAmpm .tk-ampm-btn.active")?.dataset.ampm||"AM";tkState.schedule.at=_tkComposeAt({date:i,hour12:d,minute:h,ampm:m}),_tkUpdateSchedulePreview(),_tkSaveDraftSoon()};e("tkScheduleDate")?.addEventListener("change",n),e("tkScheduleHour")?.addEventListener("change",n),e("tkScheduleMin")?.addEventListener("change",n),document.querySelectorAll("#tkAmpm .tk-ampm-btn").forEach(i=>{i.addEventListener("click",()=>{document.querySelectorAll("#tkAmpm .tk-ampm-btn").forEach(d=>d.classList.toggle("active",d===i)),n()})}),e("tkScheduleTz")?.addEventListener("change",i=>{tkState.schedule.tz=i.target.value,_tkUpdateSchedulePreview(),_tkSaveDraft()}),e("tkSubmit")?.addEventListener("click",_tkSubmit)}function _tkHandleFile(e){if(e){if(!/^video\//.test(e.type)&&!/\.(mp4|mov|webm|m4v)$/i.test(e.name)){tkState.error="That file does not look like a video.",_tkRenderForm();return}if(e.size>TIKTOK_MAX_BYTES){tkState.error=`Video is ${_tkFormatBytes(e.size)} — TikTok's limit is ${_tkFormatBytes(TIKTOK_MAX_BYTES)}.`,_tkRenderForm();return}tkState.objectUrl&&URL.revokeObjectURL(tkState.objectUrl),tkState.file=e,tkState.objectUrl=URL.createObjectURL(e),tkState.fileMeta={name:e.name,size:e.size,type:e.type},tkState.error=null,_tkSaveDraft(),_tkRenderForm()}}function _tkReplaceFile(){const e=document.getElementById("tkFile");if(e){e.click();return}const t=document.createElement("input");t.type="file",t.accept="video/mp4,video/quicktime,video/webm,video/*",t.addEventListener("change",()=>_tkHandleFile(t.files?.[0])),t.click()}function _tkClearFile(){tkState.objectUrl&&URL.revokeObjectURL(tkState.objectUrl),tkState.file=null,tkState.objectUrl=null,tkState.fileMeta=null,_tkSaveDraft(),_tkRenderForm()}function _tkImageMimeFor(e){if(/^image\/(jpeg|png|webp)$/.test(e.type))return e.type;const t=(/\.([a-z0-9]+)$/i.exec(e.name)||[])[1]?.toLowerCase();return t==="png"?"image/png":t==="webp"?"image/webp":"image/jpeg"}function _tkHandlePhotoFiles(e){if(!e||!e.length)return;const t=TIKTOK_MAX_PHOTOS-tkState.photos.length,o=Array.from(e),r=o.length>t,s=o.slice(0,Math.max(t,0));let a=null,n=0;for(const i of s){if(!(/^image\/(jpeg|png|webp)$/.test(i.type)||/\.(jpe?g|png|webp)$/i.test(i.name))){a=`"${i.name}" does not look like a JPEG, PNG or WEBP image.`;continue}if(i.size>TIKTOK_PHOTO_MAX_BYTES){a=`"${i.name}" is ${_tkFormatBytes(i.size)} — the per-image limit is ${_tkFormatBytes(TIKTOK_PHOTO_MAX_BYTES)}.`;continue}tkState.photos.push({file:i,objectUrl:URL.createObjectURL(i)}),n++}r&&(a=`Only added ${t} image${t===1?"":"s"} — the ${TIKTOK_MAX_PHOTOS}-image limit was reached.`),tkState.error=a,n&&(tkState.photosMeta=null),_tkSaveDraft(),_tkRenderForm()}function _tkFocusPhotoControl(e,t){const o=document.querySelector(`.tk-photo-btn[data-photo-idx="${e}"][data-action="${t}"]`);return o&&!o.disabled?(o.focus(),!0):!1}function _tkRemovePhoto(e){const t=tkState.photos[e];t&&(t.objectUrl&&URL.revokeObjectURL(t.objectUrl),tkState.photos.splice(e,1),_tkSaveDraft(),_tkRenderForm(),_tkFocusPhotoControl(Math.min(e,tkState.photos.length-1),"remove")||document.getElementById("tkPhotoFile")?.focus())}function _tkMovePhoto(e,t){const o=e+t;if(o<0||o>=tkState.photos.length)return;const r=tkState.photos;[r[e],r[o]]=[r[o],r[e]],_tkSaveDraft(),_tkRenderForm();const s=t<0?"move-earlier":"move-later",a=t<0?"move-later":"move-earlier";_tkFocusPhotoControl(o,s)||_tkFocusPhotoControl(o,a)||_tkFocusPhotoControl(o,"remove")}function _tkClearAllPhotos(){tkState.photos.forEach(e=>{e.objectUrl&&URL.revokeObjectURL(e.objectUrl)}),tkState.photos=[],tkState.photosMeta=null}function _tkCanSubmit(){const e=tkState.mediaType==="photo"?tkState.photos.length>0:!!tkState.file;return!!(tkState.client&&tkState.profile&&e&&tkState.title.trim()&&tkState.title.length<=2200&&!tkState.submitting)}function _tkValidate(){if(!tkState.client)return"Pick a client first.";if(!tkState.profile)return"This client has no Post For Me account mapping — add a postforme_account_id in the Clients Info sheet.";if(tkState.mediaType==="photo"){if(!tkState.photos.length)return"Attach at least one image."}else if(!tkState.file)return"Attach a video.";if(!tkState.title.trim())return"Add a caption.";if(tkState.title.length>2200)return"Caption is over the 2200-character limit.";if(!tkState.schedule.postNow){if(!tkState.schedule.at)return'Pick a schedule time, or switch on "Post immediately".';const e=new Date(tkState.schedule.at).getTime();if(!Number.isFinite(e))return"That schedule time is not valid.";if(e<Date.now()-6e4)return"The schedule time is in the past."}return null}function _tkSubmit(){if(tkState.client){const i=_tkResolveProfile(tkState.client);tkState.profile=i.profile,tkState.profileSource=i.source}const e=_tkValidate();if(e){tkState.error=e,_tkRenderForm();return}const t=crypto.randomUUID&&crypto.randomUUID()||`tk-${Date.now()}-${Math.random().toString(36).slice(2)}`,o=tkState.schedule.postNow?"":tkState.schedule.at,r=o&&_tkWallClockToUTC(o,tkState.schedule.tz)||"";if(tkState.mediaType==="photo"){_tkSubmitPhotoCarousel(t,o,r);return}if(tkState.file&&tkState.file.size>TIKTOK_LEGACY_MAX_BYTES){_tkSubmitDirect(t,o,r);return}const s={client:tkState.client,profile:tkState.profile,title:tkState.title,options:{...tkState.options},tz:tkState.schedule.tz,schedule:{postNow:tkState.schedule.postNow,at:tkState.schedule.at}},a=new FormData;a.append("clientName",s.client),a.append("socialAccountId",s.profile),a.append("title",s.title),a.append("options",JSON.stringify(s.options)),a.append("scheduledAt",o),a.append("scheduledAtUTC",r),a.append("scheduledAtUnix",r?String(Math.floor(Date.parse(r)/1e3)):""),a.append("timezone",s.tz),a.append("idempotencyKey",t),a.append("media",tkState.file,tkState.file.name),tkState.submitting=!0,tkState.error=null,tkState.progress=0,_tkRenderForm();const n=new XMLHttpRequest;_tkActiveXhr=n,n.open("POST",TIKTOK_UPLOAD_WEBHOOK),n.upload.onprogress=i=>{if(!i.lengthComputable)return;tkState.progress=Math.min(99,Math.round(i.loaded/i.total*100));const d=document.getElementById("tkProgress");d&&(d.style.width=tkState.progress+"%")},n.onload=()=>{if(_tkActiveXhr=null,tkState.submitting=!1,n.status>=200&&n.status<300){let i={};try{i=JSON.parse(n.responseText||"{}")}catch{}if(i.ok===!1){tkState.progress=0,_tkRecordFailure("tiktok_upload",0),tkState.error=i.error?`Upload failed: ${i.error}`:"Post For Me rejected this post. Try again.",_tkRenderForm();return}tkState.progress=100,_tkOnSubmitSuccess(t,o,r,i,s)}else tkState.progress=0,_tkRecordFailure("tiktok_upload",n.status),tkState.error=_tkExplainError(n),_tkRenderForm()},n.onerror=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_upload",0,!0),tkState.error="Network error — the upload could not reach n8n. Try again.",_tkRenderForm()},n.onabort=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,tkState.error="Upload cancelled.",_tkRenderForm()},n.send(a)}function _tkOnSubmitSuccess(e,t,o,r,s){tkState.progress=100;const a={id:r.id||e,client:s.client,profile:s.profile,title:s.title,status:r.status||(s.schedule.postNow?"uploading":"scheduled"),scheduled_for:s.schedule.postNow?null:o||s.schedule.at,timezone:s.tz,created_at:new Date().toISOString(),optimistic:!0},n=_tkLoadPending().filter(i=>i.id!==a.id);n.unshift(a),_tkSavePending(n),tkState.uploads=_tkMergeUploads(tkState.uploads,[a]),tkState.objectUrl&&URL.revokeObjectURL(tkState.objectUrl),tkState.file=null,tkState.objectUrl=null,tkState.fileMeta=null,_tkClearAllPhotos(),tkState.title="",tkState.progress=0,_tkClearDraft(),_tkRenderForm(),_tkRenderQueue(),showNotify("Upload queued",t?`Scheduled for ${_tkFormatScheduledLong(t,s.tz)}.`:"The post is uploading to TikTok now."),Promise.resolve(_tkFetchQueue()).finally(_tkScheduleNextPoll)}function _tkSubmitDirect(e,t,o){const r=tkState.file,s={client:tkState.client,profile:tkState.profile,title:tkState.title,options:{...tkState.options},tz:tkState.schedule.tz,schedule:{postNow:tkState.schedule.postNow,at:tkState.schedule.at}};tkState.submitting=!0,tkState.error=null,tkState.progress=0,_tkRenderForm();const a=new XMLHttpRequest;_tkActiveXhr=a,a.open("GET",TIKTOK_UPLOAD_URL_WEBHOOK),a.onload=()=>{if(a.status<200||a.status>=300){_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_upload_prepare",a.status),tkState.error=_tkExplainError(a),_tkRenderForm();return}let n={};try{n=JSON.parse(a.responseText||"{}")}catch{}if(!n.ok||!n.upload_url||!n.media_url){_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_upload_prepare",0),tkState.error="Could not prepare the upload — "+(n.error||"no upload url returned")+".",_tkRenderForm();return}_tkPutDirect(r,n.upload_url,n.media_url,e,t,o,s)},a.onerror=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_upload_prepare",0,!0),tkState.error="Network error — could not reach n8n to prepare the upload. Try again.",_tkRenderForm()},a.onabort=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,tkState.error="Upload cancelled.",_tkRenderForm()},a.send()}function _tkPutDirect(e,t,o,r,s,a,n){const i=new XMLHttpRequest;_tkActiveXhr=i,i.open("PUT",t),i.setRequestHeader("Content-Type",e.type||"video/mp4"),i.upload.onprogress=d=>{if(!d.lengthComputable)return;tkState.progress=Math.min(90,Math.round(d.loaded/d.total*90));const h=document.getElementById("tkProgress");h&&(h.style.width=tkState.progress+"%")},i.onload=()=>{if(i.status<200||i.status>=300){_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_storage_put",i.status),tkState.error=`Video upload to storage failed (HTTP ${i.status}). Try again.`,_tkRenderForm();return}_tkFinishDirectSubmit(o,r,s,a,n)},i.onerror=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_storage_put",0,!0),tkState.error="Network error while uploading the video to storage. Try again.",_tkRenderForm()},i.onabort=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,tkState.error="Upload cancelled.",_tkRenderForm()},i.send(e)}function _tkFinishDirectSubmit(e,t,o,r,s){const a=new FormData;a.append("clientName",s.client),a.append("socialAccountId",s.profile),a.append("title",s.title),a.append("options",JSON.stringify(s.options)),a.append("scheduledAt",o),a.append("scheduledAtUTC",r),a.append("scheduledAtUnix",r?String(Math.floor(Date.parse(r)/1e3)):""),a.append("timezone",s.tz),a.append("idempotencyKey",t),a.append("mediaUrl",e);const n=new XMLHttpRequest;_tkActiveXhr=n,n.open("POST",TIKTOK_UPLOAD_DIRECT_WEBHOOK),n.onload=()=>{if(_tkActiveXhr=null,tkState.submitting=!1,n.status>=200&&n.status<300){let i={};try{i=JSON.parse(n.responseText||"{}")}catch{}if(i.ok===!1){tkState.progress=0,_tkRecordFailure("tiktok_upload",0),tkState.error=i.error?`Upload failed: ${i.error}`:"Post For Me rejected this post. Try again.",_tkRenderForm();return}tkState.progress=100,_tkOnSubmitSuccess(t,o,r,i,s)}else tkState.progress=0,_tkRecordFailure("tiktok_upload",n.status),tkState.error=_tkExplainError(n),_tkRenderForm()},n.onerror=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_upload",0,!0),tkState.error="The video finished uploading to storage, but n8n could not be reached to finish creating the post. Try Submit again — this re-uploads the video (that part is not saved between attempts).",_tkRenderForm()},n.onabort=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,tkState.error="Upload cancelled.",_tkRenderForm()},n.send(a)}async function _tkSubmitPhotoCarousel(e,t,o){const r=tkState.photos.slice(),s={client:tkState.client,profile:tkState.profile,title:tkState.title,options:{...tkState.options},tz:tkState.schedule.tz,schedule:{postNow:tkState.schedule.postNow,at:tkState.schedule.at}};tkState.submitting=!0,tkState.error=null,tkState.progress=0,_tkRenderForm();const a=new AbortController;_tkActivePhotoAbort=a;const n=[];try{for(let i=0;i<r.length;i++){const{file:d}=r[i],h=await fetch(TIKTOK_UPLOAD_URL_WEBHOOK,{signal:a.signal});if(!h.ok)throw new Error(`Could not prepare image ${i+1} (HTTP ${h.status}).`);let m={};try{m=await h.json()}catch{}if(!m.ok||!m.upload_url||!m.media_url)throw new Error(`Could not prepare image ${i+1} — ${m.error||"no upload url returned"}.`);const f=await fetch(m.upload_url,{method:"PUT",headers:{"Content-Type":_tkImageMimeFor(d)},body:d,signal:a.signal});if(!f.ok)throw new Error(`Image ${i+1} upload to storage failed (HTTP ${f.status}).`);n.push(m.media_url),tkState.progress=Math.round((i+1)/r.length*90);const g=document.getElementById("tkProgress");g&&(g.style.width=tkState.progress+"%")}}catch(i){_tkActivePhotoAbort=null,tkState.submitting=!1,tkState.progress=0,i.name!=="AbortError"&&_writeUiRecordSaveFailure("tiktok","tiktok_photo_upload",i,null,{}),tkState.error=i.name==="AbortError"?"Upload cancelled.":i.message||"Image upload failed. Try again.",_tkRenderForm();return}_tkActivePhotoAbort=null,_tkFinishPhotoSubmit(n,e,t,o,s)}function _tkFinishPhotoSubmit(e,t,o,r,s){const a=new FormData;a.append("clientName",s.client),a.append("socialAccountId",s.profile),a.append("title",s.title),a.append("options",JSON.stringify(s.options)),a.append("scheduledAt",o),a.append("scheduledAtUTC",r),a.append("scheduledAtUnix",r?String(Math.floor(Date.parse(r)/1e3)):""),a.append("timezone",s.tz),a.append("idempotencyKey",t),a.append("mediaUrls",JSON.stringify(e));const n=new XMLHttpRequest;_tkActiveXhr=n,n.open("POST",TIKTOK_UPLOAD_DIRECT_WEBHOOK),n.onload=()=>{if(_tkActiveXhr=null,tkState.submitting=!1,n.status>=200&&n.status<300){let i={};try{i=JSON.parse(n.responseText||"{}")}catch{}if(i.ok===!1){tkState.progress=0,_tkRecordFailure("tiktok_upload",0),tkState.error=i.error?`Upload failed: ${i.error}`:"Post For Me rejected this post. Try again.",_tkRenderForm();return}tkState.progress=100,_tkOnSubmitSuccess(t,o,r,i,s)}else tkState.progress=0,_tkRecordFailure("tiktok_upload",n.status),tkState.error=_tkExplainError(n),_tkRenderForm()},n.onerror=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,_tkRecordFailure("tiktok_upload",0,!0),tkState.error="The images finished uploading to storage, but n8n could not be reached to finish creating the post. Try Submit again — this re-uploads the images (that part is not saved between attempts).",_tkRenderForm()},n.onabort=()=>{_tkActiveXhr=null,tkState.submitting=!1,tkState.progress=0,tkState.error="Upload cancelled.",_tkRenderForm()},n.send(a)}function _tkRecordFailure(e,t,o){const r={message:t?"HTTP "+t:o?"network error":"upload rejected"};t?r.status=t:o&&(r.network=!0),_writeUiRecordFailure("tiktok",e,r,{})}function _tkExplainError(e){try{const t=JSON.parse(e.responseText||"{}");if(t.message)return`Upload failed: ${t.message}`;if(t.error)return`Upload failed: ${t.error}`}catch{}return`Upload failed (HTTP ${e.status||"no response"}). Check the n8n workflow.`}function _tkCancelUpload(){_tkActiveXhr&&_tkActiveXhr.abort(),_tkActivePhotoAbort&&_tkActivePhotoAbort.abort()}function _tkMergeUploads(e,t){const o=new Map;for(const r of e)o.set(r.id,r);for(const r of t){const s=o.get(r.id);o.set(r.id,s?{...s,...r,optimistic:r.optimistic&&s.optimistic}:r)}return[...o.values()].sort((r,s)=>{const a=r.scheduled_for||r.created_at||"";return(s.scheduled_for||s.created_at||"").localeCompare(a)})}function _tkLoadQueueCache(){try{const e=JSON.parse(localStorage.getItem(TIKTOK_QUEUE_CACHE_KEY)||"null");return e&&Array.isArray(e.rows)?e.rows:[]}catch{return[]}}function _tkSaveQueueCache(e){try{localStorage.setItem(TIKTOK_QUEUE_CACHE_KEY,JSON.stringify({at:Date.now(),rows:e.slice(0,100)}))}catch{}}async function _tkFetchQueue(){try{const e=await fetch(TIKTOK_UPLOADS_LIST_URL+"?_t="+Date.now(),{method:"GET",signal:AbortSignal.timeout?AbortSignal.timeout(2e4):void 0});if(!e.ok)throw new Error("HTTP "+e.status);const t=await e.json(),o=Array.isArray(t)?t:t.rows||t.items||[];_tkSaveQueueCache(o);const r=_tkPrunePending(_tkLoadPending()),s=tkState.queueFromCache?null:JSON.stringify(tkState.uploads),a=tkState.queueReadState!=="ready";tkState.uploads=_tkMergeUploads(r,o);const n=new Set(o.map(d=>d.id));_tkSavePending(r.filter(d=>!n.has(d.id))),tkState.queueFromCache=!1,tkState.queueReadState="ready",tkState.queueFailures=0;const i=JSON.stringify(tkState.uploads);tkState.unchangedPolls=i===tkState.lastReadSig?(tkState.unchangedPolls||0)+1:0,tkState.lastReadSig=i,(a||JSON.stringify(tkState.uploads)!==s)&&_tkRenderQueue(),await _tkLookupOverdue()}catch{tkState.queueReadState="error",tkState.queueFailures++,tkState.queueFromCache=!0,_tkRenderQueue()}}const TK_UPCOMING=["queued","uploading","processing","scheduled"],TK_STATUS_LABELS={noresult:"No result from Post For Me",queued:"Queued",uploading:"Uploading",processing:"Uploading",scheduled:"Scheduled",posted:"Posted",failed:"Failed",cancelled:"Cancelled",canceled:"Cancelled"};function _tkRowTime(e){const t=e.scheduled_for||e.posted_at||e.updated_at||e.created_at;if(!t)return null;if(/Z$|[+\-]\d{2}:?\d{2}$/.test(t)){const s=new Date(t);return Number.isNaN(s.getTime())?null:s}const o=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(t);if(o)return new Date(+o[1],+o[2]-1,+o[3],+o[4],+o[5]);const r=new Date(t);return Number.isNaN(r.getTime())?null:r}function _tkRelative(e){const t=Math.abs(e),o=Math.round(t/6e4),r=o<1?"less than a minute":o<60?`${o} min`:o<2160?`${Math.round(o/60)} h`:`${Math.round(o/1440)} days`;return e>=0?`in ${r}`:`${r} ago`}function _tkWhenParts(e,t){const o=_tkRowTime(e);if(TK_UPCOMING.includes(t)&&!e.scheduled_for)return{day:"Today",time:"Now",rel:t==="queued"?"waiting its turn":""};if(!o)return{day:"",time:"—",rel:""};const r=e.scheduled_for&&e.timezone?e.timezone:void 0;let s,a,n;try{s=o.toLocaleDateString("en-CA",{timeZone:r}),a=new Date().toLocaleDateString("en-CA",{timeZone:r}),n=o.toLocaleTimeString(void 0,{hour:"numeric",minute:"2-digit",timeZone:r})}catch{s=o.toLocaleDateString("en-CA"),a=new Date().toLocaleDateString("en-CA"),n=o.toLocaleTimeString(void 0,{hour:"numeric",minute:"2-digit"})}const i=Math.round((Date.parse(s)-Date.parse(a))/864e5);return{day:i===0?"Today":i===1?"Tomorrow":i===-1?"Yesterday":o.toLocaleDateString(void 0,{month:"short",day:"numeric",timeZone:r}),time:n,rel:_tkRelative(o.getTime()-Date.now())}}function _tkSetQueueTab(e){tkState.queueTab=e,tkState.queueLimit=TK_QUEUE_PAGE,_tkRenderQueue(),document.querySelector("#tkQueueCol .tk-q-tab.on")?.focus()}function _tkQueueShowMore(){const e=tkState.queueLimit;tkState.queueLimit+=TK_QUEUE_PAGE,_tkRenderQueue(),(document.querySelectorAll("#tkQueueCol .tk-queue-item")[e]?.querySelector("button, a")||document.querySelector("#tkQueueCol .tk-q-more")||document.querySelector("#tkQueueCol .tk-q-tab.on"))?.focus()}function _tkRenderQueue(){const e=document.getElementById("tkQueueCol");if(!e)return;const t=_tkLoadHidden(),o=tkState.uploads.filter(l=>!t.has(l.id)),r=l=>{const c=_tkRowTime(l);return c?c.getTime():0},s={upcoming:o.filter(l=>TK_UPCOMING.includes(_tkEffectiveStatus(l))).sort((l,c)=>(l.scheduled_for?r(l):-1/0)-(c.scheduled_for?r(c):-1/0)),failed:o.filter(l=>["failed","noresult"].includes(_tkEffectiveStatus(l))).sort((l,c)=>r(c)-r(l)),done:o.filter(l=>!TK_UPCOMING.includes(_tkEffectiveStatus(l))&&!["failed","noresult"].includes(_tkEffectiveStatus(l))).sort((l,c)=>r(c)-r(l))},a=s[tkState.queueTab]?tkState.queueTab:"upcoming",n=s[a],i=n.slice(0,tkState.queueLimit),d=n.length-i.length,h=l=>{const c=_tkEffectiveStatus(l),v=(tkState.pfm||{})[l.id]||{};!l.tiktok_url&&v.url&&(l={...l,tiktok_url:v.url}),!l.error&&c==="failed"&&v.error&&(l={...l,error:v.error});const b=_tkWhenParts(l,c),u=[],k=tkState.queueFromCache&&!l.optimistic,x=_tkEscape(l.id);!k&&(c==="scheduled"||c==="queued")&&u.push(`<button type="button" class="tk-q-btn tk-q-danger" onclick="_tkCancelRow('${x}')">Cancel</button>`),!k&&c==="failed"&&!_tkIsOverdue(l)&&u.push(`<button type="button" class="tk-q-btn tk-q-primary" onclick="_tkRetryRow('${x}')">Retry</button>`),l.tiktok_url&&u.push(`<a class="tk-q-btn" href="${_tkEscape(l.tiktok_url)}" target="_blank" rel="noopener">Open</a>`),k||u.push(`<button type="button" class="tk-q-btn tk-q-x" onclick="_tkDismissRow('${x}')" title="Dismiss" aria-label="Dismiss">&times;</button>`);const p=l.scheduled_for&&l.timezone?` · ${_tkEscape(l.timezone.split("/").pop().replace(/_/g," "))}`:"";return`
                <div class="tk-queue-item${k?" tk-queue-item-cached":""}">
                    <div class="tk-q-when"><div class="tk-q-day">${_tkEscape(b.day)}</div><div class="tk-q-time">${_tkEscape(b.time)}</div></div>
                    <div class="tk-q-main">
                        <div class="tk-queue-client">${_tkEscape(l.client||"—")}</div>
                        ${l.title?`<div class="tk-queue-title">${_tkEscape(l.title)}</div>`:""}
                        <div class="tk-q-meta"><span class="tk-st ${_tkEscape(c)}">${_tkEscape(TK_STATUS_LABELS[c]||c)}</span><span>${_tkEscape(b.rel)}${p}</span></div>
                        ${l.error?`<div class="tk-queue-error">${_tkEscape(l.error)}</div>`:""}
                    </div>
                    ${u.length?`<div class="tk-queue-actions">${u.join("")}</div>`:""}
                </div>`},m=(l,c)=>`<button type="button" class="tk-q-tab${a===l?" on":""}${l==="failed"&&s.failed.length?" alert":""}" role="tab" aria-selected="${a===l}" onclick="_tkSetQueueTab('${l}')">${c}<b>${tkState.queueReadState==="ready"?s[l].length:"—"}</b></button>`,f={upcoming:"Nothing scheduled yet.",failed:"No failed uploads.",done:"No posts yet."}[a],g=tkState.queueReadState==="loading"?'<div class="tk-queue-empty" role="status">Loading uploads…</div>':tkState.queueReadState==="error"?`<div class="tk-queue-empty" role="alert">Couldn't load your uploads. ${o.length?"Showing available rows. ":""}Trying again shortly.</div>`:"";e.innerHTML=`
            <div class="tk-card">
                <h3>Uploads</h3>
                <div class="tk-q-tabs" role="tablist">${m("upcoming","Upcoming")}${m("failed","Failed")}${m("done","Done")}</div>
                ${g}
                ${i.length?i.map(h).join(""):tkState.queueReadState==="ready"?`<div class="tk-queue-empty">${f}</div>`:""}
                ${d>0?`<button type="button" class="tk-q-more" onclick="_tkQueueShowMore()">Show ${Math.min(d,TK_QUEUE_PAGE)} more <span>· ${d} left</span></button>`:""}
            </div>
        `}async function _tkCancelRow(e){showConfirm("Cancel upload?","This marks the upload as cancelled in your queue. If it was already scheduled in Post For Me you may also need to cancel it there. The video file stays on your computer.",async()=>{try{const t=await _writeUiTrackSave("tiktok","tiktok_cancel",{},()=>fetch(TIKTOK_UPLOAD_CANCEL_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e})}));if(!t.ok)throw new Error("HTTP "+t.status);_tkSavePending(_tkLoadPending().filter(o=>o.id!==e)),Promise.resolve(_tkFetchQueue()).finally(_tkScheduleNextPoll)}catch(t){showNotify("Could not cancel",t.message||"The n8n cancel webhook failed.")}},"Cancel upload")}function _tkDismissRow(e){_tkSavePending(_tkLoadPending().filter(o=>o.id!==e));const t=_tkLoadHidden();t.add(e),_tkSaveHidden(t),tkState.uploads=tkState.uploads.filter(o=>o.id!==e),_tkRenderQueue()}async function _tkRetryRow(e){try{const t=await _writeUiTrackSave("tiktok","tiktok_retry",{},()=>fetch(TIKTOK_UPLOAD_STATUS_URL+"?id="+encodeURIComponent(e)+"&retry=1",{method:"POST"}));if(!t.ok)throw new Error("HTTP "+t.status);Promise.resolve(_tkFetchQueue()).finally(_tkScheduleNextPoll)}catch(t){showNotify("Retry failed",t.message||"The n8n status webhook did not accept the retry.")}}function _tkActiveUploadCount(){return(tkState.uploads||[]).filter(e=>{const t=_tkEffectiveStatus(e);return t==="queued"||t==="uploading"||t==="processing"}).length}function _tkHasScheduled(){return(tkState.uploads||[]).some(e=>_tkEffectiveStatus(e)==="scheduled")}function _tkUnresolvedOverdue(){const e=tkState.pfm||{};return(tkState.uploads||[]).filter(t=>_tkIsOverdue(t)&&!["posted","failed"].includes((e[t.id]||{}).state))}const TK_LOOKUP_EVERY_MS=10*6e4;function _tkLookupGap(e){return TK_LOOKUP_EVERY_MS*((e||0)<3?1:(e||0)<5?3:6)}async function _tkLookupOverdue(){tkState.pfm=tkState.pfm||{};const e=_tkUnresolvedOverdue().filter(o=>o.upload_post_id&&!(Date.now()-((tkState.pfm[o.id]||{}).at||0)<_tkLookupGap((tkState.pfm[o.id]||{}).n))).sort((o,r)=>((tkState.pfm[o.id]||{}).at||0)-((tkState.pfm[r.id]||{}).at||0)).slice(0,5);let t=!1;for(const o of e)try{const r=await fetch(TIKTOK_UPLOAD_STATUS_URL+"?id="+encodeURIComponent(o.id)+"&_t="+Date.now(),{method:"GET",signal:AbortSignal.timeout?AbortSignal.timeout(2e4):void 0}),s=r.ok?await r.json():null,a=s&&s.pfm||null,n=tkState.pfm[o.id]||{};tkState.pfm[o.id]={...a||{state:"unknown"},at:Date.now(),n:s?(n.n||0)+1:n.n||0},n.state!==tkState.pfm[o.id].state&&(t=!0)}catch{tkState.pfm[o.id]={...tkState.pfm[o.id]||{},state:(tkState.pfm[o.id]||{}).state||"unknown",at:Date.now(),n:(tkState.pfm[o.id]||{}).n||0}}t&&_tkRenderQueue()}function _tkNextPollDelay(){if(tkState.queueReadState==="error")return Math.min(3e5,3e4*2**Math.min(tkState.queueFailures-1,4));const e=tkState.unchangedPolls||0;return _tkActiveUploadCount()>0?e<=6?3e4:e<=12?6e4:12e4:_tkHasScheduled()?e<=3?12e4:e<=9?3e5:6e5:_tkUnresolvedOverdue().length?e<=2?3e5:e<=6?6e5:9e5:0}function _tkStopPolling(){_tkPollTimer&&(clearTimeout(_tkPollTimer),_tkPollTimer=null)}function _tkScheduleNextPoll(){if(_tkStopPolling(),!_tkMounted||typeof document<"u"&&document.visibilityState==="hidden"||!document.getElementById("tkQueueCol"))return;const e=_tkNextPollDelay();e<=0||(_tkPollTimer=setTimeout(()=>{_tkPollTimer=null,Promise.resolve(_tkFetchQueue()).finally(_tkScheduleNextPoll)},e))}function _tkTeardown(){_tkMounted=!1,_tkStopPolling(),tkState.objectUrl&&(URL.revokeObjectURL(tkState.objectUrl),tkState.objectUrl=null),tkState.file&&(tkState.objectUrl=URL.createObjectURL(tkState.file)),tkState.photos.forEach(e=>{e.objectUrl&&URL.revokeObjectURL(e.objectUrl)}),tkState.photos.forEach(e=>{e.objectUrl=URL.createObjectURL(e.file)})}function mountTiktokUploadView(){_tkLoadDraft();const e=svSharedClientFor("tiktok-upload"),t=!!(tkState.title||tkState.fileMeta||tkState.photosMeta&&tkState.photosMeta.length);if(e&&e!==tkState.client&&WL_CLIENT_NAMES.includes(e)&&!t&&(tkState.client=e,_tkSaveDraft()),tkState.client){const r=_tkResolveProfile(tkState.client);tkState.profile=r.profile,tkState.profileSource=r.source}const o=_tkLoadQueueCache();tkState.uploads=_tkMergeUploads(_tkPrunePending(_tkLoadPending()),o),tkState.queueFromCache=o.length>0,tkState.queueReadState="loading",tkState.queueFailures=0,tkState.unchangedPolls=0,_tkRenderForm(),_tkRenderPreview(),_tkRenderQueue(),_tkMounted=!0,Promise.resolve(_tkFetchQueue()).finally(_tkScheduleNextPoll),_tkVisHooked||(_tkVisHooked=!0,document.addEventListener("visibilitychange",()=>{_tkMounted&&(document.visibilityState==="visible"?(tkState.unchangedPolls=0,Promise.resolve(_tkFetchQueue()).finally(_tkScheduleNextPoll)):_tkStopPolling())}))}window._tkReplaceFile=_tkReplaceFile,window._tkClearFile=_tkClearFile,window._tkRemovePhoto=_tkRemovePhoto,window._tkMovePhoto=_tkMovePhoto,window._tkCancelUpload=_tkCancelUpload,window._tkCancelRow=_tkCancelRow,window._tkRetryRow=_tkRetryRow,window._tkDismissRow=_tkDismissRow,window._tkSetQueueTab=_tkSetQueueTab,window._tkQueueShowMore=_tkQueueShowMore,svAreaRegister("tiktok",{render:renderTiktokUploadView,mount:mountTiktokUploadView,teardown:_tkTeardown,isMounted:()=>_tkMounted,renderForm:_tkRenderForm}),Object.assign(window,{_tkCancelRow,_tkCancelUpload,_tkClearFile,_tkDismissRow,_tkMovePhoto,_tkQueueShowMore,_tkRemovePhoto,_tkReplaceFile,_tkRetryRow,_tkSetQueueTab});

;(self.__svParts || (self.__svParts = [])).push("js/sv-14-tiktok-c2e4ac7240df.js");
