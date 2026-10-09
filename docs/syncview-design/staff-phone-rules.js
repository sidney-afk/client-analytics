/* STAFF-PHONE-RULES:BEGIN
 * Artifact controller, transplanted verbatim into the staff phone bar fragment.
 * Native controls and handlers survive: only their phone presentation moves.
 */
(function () {
    const phone = matchMedia('(max-width: 767px)');
    let dispose = null;
    function start() {
        if (dispose) { dispose(); dispose = null; }
        if (!phone.matches || document.documentElement.classList.contains('boot-client')
            || document.body.matches('.intake-mode, .onboarding-mode')) return;
        const html = document.documentElement;
        html.classList.add('sv-staff-phone');
        const moves = new Map(), labels = new Map(), overlays = new Map(), actionListeners = [];
        let lastTrigger = null, locked = null, queued = false, touch = null;
        // Discover both semantic dialogs and the app's older floating surfaces.
        // A tooltip is explanatory, and never locks its underlying screen.
        const candidates = '.cal-lightbox.open, .kasper-lightbox.open, dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [class*="-overlay"], [class*="-popup"], [class*="-popover"], [class*="-menu"], [class*="-dropdown"], .prod-pop, .prod-cmd-bd, .cal-card-color-picker, .sv-client-pop, #svJump:not([hidden])';
        function shown(el) {
            // These are inline card affordances, not an open menu or modal.
            if (el.matches('.cal-review-video-overlay, .cal-card-select-overlay, .kasper-hero-poster-overlay')) return false;
            if (!el.isConnected || !el.checkVisibility({ checkVisibilityCSS: true })
                || el.closest('dialog:not([open]), [hidden]')) return false;
            const css = getComputedStyle(el), rect = el.getBoundingClientRect();
            return css.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0 && (css.opacity !== '0' || el.matches('.open, .active, .is-open, dialog[open]'))
                && (el.matches('dialog[open]') || /^(fixed|absolute)$/.test(css.position));
        }
        function move(el, parent) {
            if (!moves.has(el)) moves.set(el, { parent: el.parentNode, next: el.nextSibling });
            parent.append(el);
        }
        function topSurface(roots) {
            const modal = roots.filter(el => el.matches('dialog[open]')).at(-1);
            if (modal) roots = roots.filter(el => el === modal || modal.contains(el));
            const leaves = roots.filter(el => !roots.some(other => el !== other && el.contains(other)));
            return leaves.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0))[0];
        }
        function cards() {
            document.querySelectorAll('#calView .cal-card, #sxrView .cal-card').forEach(card => {
                const thumb = card.querySelector('.cal-card-thumb');
                if (!thumb) return;
                let tools = thumb.querySelector('.sv-phone-card-tools');
                if (!tools) {
                    tools = document.createElement('div'); tools.className = 'sv-phone-card-tools';
                    tools.innerHTML = '<div class="sv-phone-card-primary"></div><div class="sv-phone-card-secondary"></div><dialog class="sv-phone-card-menu"><div class="sv-phone-card-head"><strong>Card actions</strong><button type="button" aria-label="Close card actions">Close</button></div><div class="sv-phone-card-body"></div></dialog>';
                    thumb.append(tools);
                    const menu = tools.querySelector('dialog'), primary = tools.firstElementChild;
                    const more = document.createElement('button'); more.type = 'button'; more.className = 'sv-phone-card-more';
                    more.setAttribute('aria-label', 'More card actions'); more.setAttribute('aria-haspopup', 'dialog'); more.setAttribute('aria-expanded', 'false');
                    more.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>';
                    primary.append(more);
                    more.onclick = event => { event.stopPropagation(); menu.showModal(); more.setAttribute('aria-expanded', 'true'); };
                    menu.querySelector('button').onclick = event => { event.stopPropagation(); menu.close(); };
                    menu.addEventListener('close', () => { more.setAttribute('aria-expanded', 'false'); if (more.isConnected) more.focus({preventScroll:true}); });
                    menu.addEventListener('click', event => { event.stopPropagation(); if (event.target === menu) menu.close(); });
                }
                const primary = tools.querySelector('.sv-phone-card-primary'), secondary = tools.querySelector('.sv-phone-card-secondary');
                const menu = tools.querySelector('dialog'), body = menu.querySelector('.sv-phone-card-body'), more = primary.querySelector('.sv-phone-card-more');
                // The native thumbnail subtree is retained, including native
                // callbacks. Archive is intentionally available only after More.
                card.querySelectorAll('.cal-card-platforms, .cal-card-color-tag').forEach(el => {
                    if (el.parentNode !== primary) { move(el, primary); primary.append(more); }
                });
                card.querySelectorAll('.cal-linear-pile, .cal-smm-warn-overlay').forEach(el => {
                    const target = el.matches('.cal-linear-pile') && !card.querySelector('.cal-card-platforms, .cal-smm-warn-overlay') ? primary : secondary;
                    if (el.parentNode !== target) move(el, target);
                });
                card.querySelectorAll('.cal-card-link, .cal-card-del').forEach(el => {
                    if (el.parentNode === body) return;
                    move(el, body);
                    const label = document.createElement('span'); label.className = 'sv-phone-action-label';
                    label.textContent = el.matches('.cal-card-del') ? 'Archive card' : 'Copy card link'; el.append(label);
                    const close = () => menu.close(); el.addEventListener('click', close, true); actionListeners.push([el, close]);
                });
                more.hidden = !body.childElementCount;
            });
            document.querySelectorAll('#calView .cal-cap-toggle, #sxrView .cal-cap-toggle').forEach(btn => {
                const label = btn.querySelector('.cal-cap-toggle-txt');
                if (!labels.has(btn)) labels.set(btn, { text: label?.textContent, tabindex: btn.getAttribute('tabindex'), aria: btn.getAttribute('aria-expanded') });
                const open = btn.classList.contains('is-expanded');
                const text = open ? 'Show less' : 'Show more';
                if (label && label.textContent !== text) label.textContent = text;
                if (btn.getAttribute('aria-expanded') !== String(open)) btn.setAttribute('aria-expanded', String(open));
                if (btn.tabIndex !== 0) btn.tabIndex = 0;
            });
            for (const el of moves.keys()) if (!el.isConnected) moves.delete(el);
            for (const el of labels.keys()) if (!el.isConnected) labels.delete(el);
        }
        function lock() {
            if (locked) return;
            locked = { x: scrollX, y: scrollY, styles: ['position', 'top', 'left', 'width'].map(key => [key, document.body.style.getPropertyValue(key), document.body.style.getPropertyPriority(key)]) };
            document.body.style.position = 'fixed';
            document.body.style.top = -locked.y + 'px';
            document.body.style.left = -locked.x + 'px';
            document.body.style.width = '100%';
            html.classList.add('sv-phone-locked');
        }
        function unlock() {
            if (!locked) return;
            const prior = locked; locked = null;
            html.classList.remove('sv-phone-locked');
            prior.styles.forEach(([key, value, priority]) => {
                if (value) document.body.style.setProperty(key, value, priority);
                else document.body.style.removeProperty(key);
            });
            window.scrollTo(prior.x, prior.y);
        }
        function sync() {
            queued = false;
            if (!html.classList.contains('sv-staff-phone')) return;
            cards();
            const active = [...document.querySelectorAll(candidates)].filter(shown);
            let returnTo = null;
            for (const [el, trigger] of overlays) if (!active.includes(el)) {
                returnTo = trigger; overlays.delete(el);
            }
            active.forEach(el => {
                if (!overlays.has(el)) {
                    const trigger = liveTrigger(lastTrigger)
                        || document.querySelector('[data-staff-menu="more"], #fphMoreBtn, .pocket-staff-more-btn, [data-kasper-more-trigger]');
                    overlays.set(el, trigger);
                }
            });
            if (active.length) lock(); else unlock();
            returnTo = liveTrigger(returnTo);
            if (returnTo
                && (!active.length || active.some(el => el.contains(returnTo)))) returnTo.focus({ preventScroll: true });
        }
        function liveTrigger(trigger) {
            // Native pickers can repaint their trigger on opening and closing.
            // Follow its stable id so a disconnected old node cannot redirect
            // focus to the page's unrelated More button after native restore.
            const current = trigger?.isConnected ? trigger : trigger?.id ? document.getElementById(trigger.id) : null;
            return current?.checkVisibility() ? current : null;
        }
        function schedule() {
            if (!queued) { queued = true; queueMicrotask(sync); }
        }
        function pointer(event) {
            const el = event.target.closest('button, a[href], input, textarea, [role="button"], [tabindex]');
            if (el) {
                const cardMenu = el.closest('.sv-phone-card-menu');
                lastTrigger = cardMenu ? cardMenu.closest('.cal-card')?.querySelector('.sv-phone-card-more') || el : el;
            }
        }
        function insideDialog(event) {
            const dialog = event.target;
            if (!dialog.matches?.('dialog[open]')) return;
            const r = dialog.getBoundingClientRect();
            // A native dialog's padding is INSIDE; its ::backdrop is OUTSIDE.
            // Both events target the dialog, so target equality cannot tell them apart.
            if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) event.stopImmediatePropagation();
        }
        function scroll(event, dx, dy) {
            if (!locked) return;
            const root = topSurface([...overlays.keys()].filter(shown));
            const point = event.touches?.[0] || event, rect = root?.getBoundingClientRect();
            if (!root?.contains(event.target) || point.clientX < rect.left || point.clientX > rect.right || point.clientY < rect.top || point.clientY > rect.bottom) { event.preventDefault(); return; }
            // Allow the popup's own scroll, but consume the gesture at its edge.
            // This also protects independently scrollable background workspaces.
            let el = event.target;
            while (el && root.contains(el)) {
                const css = getComputedStyle(el);
                if (dy && /auto|scroll/.test(css.overflowY) && el.scrollHeight > el.clientHeight
                    && (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return;
                if (dx && /auto|scroll/.test(css.overflowX) && el.scrollWidth > el.clientWidth
                    && (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return;
                if (el === root) break;
                el = el.parentElement;
            }
            event.preventDefault();
        }
        const wheel = e => scroll(e, e.deltaX, e.deltaY);
        function escape(event) {
            if (event.key !== 'Escape') return;
            // These legacy pickers have native outside-click close handlers,
            // but did not have Escape. Use their state-clearing close paths.
            const top = topSurface([...overlays.keys()].filter(shown));
            if (top?.matches('.cal-card-color-picker') && typeof window._calCloseColorPicker === 'function') window._calCloseColorPicker();
            else if (top?.matches('.pin-selector-dropdown.open') && typeof window.closePinSelector === 'function') window.closePinSelector();
        }
        const touchStart = e => { const t = e.touches[0]; touch = t ? [t.clientX, t.clientY] : null; };
        const touchMove = e => {
            const t = e.touches[0];
            if (!t || !touch || e.touches.length > 1) return;
            scroll(e, touch[0] - t.clientX, touch[1] - t.clientY);
            touch = [t.clientX, t.clientY];
        };
        function viewport() {
            const vv = window.visualViewport;
            html.style.setProperty('--sv-phone-vh', (vv?.height || innerHeight) + 'px');
            html.style.setProperty('--sv-phone-vtop', (vv?.offsetTop || 0) + 'px');
            const field = document.activeElement;
            if (!field?.matches('input, textarea, [contenteditable="true"]')) return;
            requestAnimationFrame(() => {
                if (!field.isConnected || document.activeElement !== field) return;
                const rect = field.getBoundingClientRect(), top = (vv?.offsetTop || 0) + 16, bottom = top + (vv?.height || innerHeight) - 32;
                if (rect.bottom > bottom || rect.top < top) field.scrollIntoView({ block: 'center', behavior: 'instant' });
            });
        }
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class', 'hidden', 'style'] });
        document.addEventListener('pointerdown', pointer, true);
        document.addEventListener('click', insideDialog, true);
        document.addEventListener('keydown', escape);
        document.addEventListener('wheel', wheel, { capture: true, passive: false });
        document.addEventListener('touchstart', touchStart, { capture: true, passive: true });
        document.addEventListener('touchmove', touchMove, { capture: true, passive: false });
        document.addEventListener('focusin', viewport);
        window.visualViewport?.addEventListener('resize', viewport);
        window.visualViewport?.addEventListener('scroll', viewport);
        viewport(); sync();
        dispose = () => {
            observer.disconnect(); unlock();
            document.removeEventListener('pointerdown', pointer, true);
            document.removeEventListener('click', insideDialog, true);
            document.removeEventListener('keydown', escape);
            document.removeEventListener('wheel', wheel, true);
            document.removeEventListener('touchstart', touchStart, true);
            document.removeEventListener('touchmove', touchMove, true);
            document.removeEventListener('focusin', viewport);
            window.visualViewport?.removeEventListener('resize', viewport);
            window.visualViewport?.removeEventListener('scroll', viewport);
            // Reverse insertion order restores sibling order even when adjacent
            // controls were moved into one row. No clone loses a native listener.
            [...moves].reverse().forEach(([el, prior]) => {
                if (el.isConnected && prior.parent.isConnected) prior.parent.insertBefore(el, prior.next?.parentNode === prior.parent ? prior.next : null);
            });
            labels.forEach((prior, btn) => {
                if (!btn.isConnected) return;
                const text = btn.querySelector('.cal-cap-toggle-txt'); if (text) text.textContent = prior.text;
                for (const [key, value] of [['tabindex', prior.tabindex], ['aria-expanded', prior.aria]]) {
                    if (value === null) btn.removeAttribute(key); else btn.setAttribute(key, value);
                }
            });
            actionListeners.forEach(([el, listener]) => el.removeEventListener('click', listener, true));
            document.querySelectorAll('.sv-phone-action-label').forEach(el => el.remove());
            document.querySelectorAll('.sv-phone-card-tools').forEach(el => el.remove());
            html.classList.remove('sv-staff-phone');
            html.style.removeProperty('--sv-phone-vh'); html.style.removeProperty('--sv-phone-vtop');
        };
    }
    phone.addEventListener('change', start);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
/* STAFF-PHONE-RULES:END */
