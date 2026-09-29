    function _kasperRefreshTabCounts() {
        // review = cards still waiting on Kasper's decision. _kasperState.items is
        // also restored from cache on entry, so a returning Kasper sees a real
        // number before the network round-trip even finishes.
        if (Array.isArray(_kasperState.items) && _kasperState.lastLoaded) {
            // Urgent is carved OUT of waiting, so the tab pill has to add it
            // back -- otherwise pinging a card silently decrements the count of
            // work he still owes.
            const _parts = _kasperPartitionItems(_kasperState.items);
            // Samples waiting on him are listed in the Review queue too.
            const _sxrOpen = typeof _kasperSampleOpenCount === 'function' ? _kasperSampleOpenCount() : 0;
            _kasperSetTabCount('review', _parts.urgent.length + _parts.waiting.length + _sxrOpen);
        }
        // replies = unread message threads — owned by _kasperUpdateReplyCount, which
        // every load already calls. Deliberately NOT painted here: it isn't part of
        // the entry cache, so doing so would flash a stale 0 before the first fetch.
        // filming = clients not yet covered (a plan is needed now or soon).
        const fd = _kasperState.filmingData;
        if (fd && Array.isArray(fd.rows)) {
            _kasperSetTabCount('filming', fd.rows.filter(r => r && r.status !== 'green').length);
        }
        if (_ptoEnabled() && _ptoAdminState.overview) {
            _kasperSetTabCount('time-off', _ptoAdminPending(_ptoAdminState.overview).length);
        }
        const onboardingUnread = _kasperOnboardingUnreadCount();
        if (onboardingUnread !== null) _kasperSetTabCount('onboarding', onboardingUnread);
    }

;(self.__svParts || (self.__svParts = [])).push("js/sv-18-core-dd9985e268b4.js");
