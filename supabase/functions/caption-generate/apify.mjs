// The fallback the n8n workflow uses when the direct Frame.io lookup fails: Apify's web-scraper opens the share page
// in a browser, records every assets.frame.io file the player loads, and returns the best audio or video file.
// Copied from the n8n "Prepare Apify Input" and "Extract Video URL" steps (read 2026-10-09). Nothing here touches a
// network; index.ts sends the actor input.

const injectedInterceptor = function () {
  window.__capturedFrameUrls = [];
  const BS = String.fromCharCode(92);
  function captureFrom(text) {
    if (!text || typeof text !== 'string') return;
    var t = text;
    if (t.indexOf(BS + 'u002F') !== -1) t = t.split(BS + 'u002F').join('/');
    if (t.indexOf(BS + 'u0026') !== -1) t = t.split(BS + 'u0026').join('&');
    if (t.indexOf(BS + '/') !== -1) t = t.split(BS + '/').join('/');
    var marker = 'https://assets.frame.io/';
    var i = 0;
    while (true) {
      i = t.indexOf(marker, i);
      if (i === -1) break;
      var j = i + marker.length;
      while (j < t.length) {
        var c = t.charCodeAt(j);
        if (c === 34 || c === 39 || c === 32 || c === 60 || c === 62 || c === 92 || c === 10 || c === 13 || c === 9 || c === 123 || c === 125 || c === 96) break;
        j++;
      }
      if (j > i + marker.length) {
        var url = t.substring(i, j);
        if (window.__capturedFrameUrls.indexOf(url) === -1) window.__capturedFrameUrls.push(url);
      }
      i = j;
    }
  }
  var origFetch = window.fetch;
  window.fetch = async function () {
    var resp = await origFetch.apply(this, arguments);
    try { captureFrom(await resp.clone().text()); } catch (e) {}
    return resp;
  };
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function () { return origOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      xhr.addEventListener('load', function () {
        try { if (typeof xhr.responseText === 'string') captureFrom(xhr.responseText); } catch (e) {}
      });
      return origSend.apply(xhr, arguments);
    };
  } catch (e) {}
};

const pageFunctionBody = function pageFunction(context) {
  return new Promise(function (resolve) {
    function clickPlayButtons() {
      try {
        var sels = ['button[aria-label*="Play" i]', 'button[title*="Play" i]', 'button[data-testid*="play" i]', '[role="button"][aria-label*="Play" i]'];
        for (var s = 0; s < sels.length; s++) {
          var btns = document.querySelectorAll(sels[s]);
          for (var b = 0; b < btns.length; b++) { try { btns[b].click(); } catch (e) {} }
        }
      } catch (e) {}
    }
    function pokeVideo() {
      try {
        var vids = document.querySelectorAll('video');
        for (var v = 0; v < vids.length; v++) {
          try { vids[v].muted = true; vids[v].playsInline = true; var pr = vids[v].play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
        }
      } catch (e) {}
    }
    function nudge() { clickPlayButtons(); pokeVideo(); }
    setTimeout(nudge, 1500); setTimeout(nudge, 4000); setTimeout(nudge, 8000); setTimeout(nudge, 14000);
    setTimeout(function () {
      var captured = (window.__capturedFrameUrls || []).slice();
      var entries = performance.getEntriesByType('resource') || [];
      var all = captured.slice();
      for (var i = 0; i < entries.length; i++) {
        var u = entries[i].name || '';
        if (u.indexOf('assets.frame.io/') !== -1 && all.indexOf(u) === -1) all.push(u);
      }
      var audioOnly = [], combined = [], originalSrc = [], videoOnly = [];
      for (var k = 0; k < all.length; k++) {
        var uu = all[k];
        if (uu.indexOf('.m3u8') !== -1 || uu.indexOf('.mpd') !== -1) continue;
        var path = uu.split('?')[0];
        var fname = path.substring(path.lastIndexOf('/') + 1);
        var low = fname.toLowerCase();
        if (low.indexOf('audio') === 0 || low.indexOf('audio_') !== -1 || low.indexOf('.m4a') !== -1 || low.indexOf('.aac') !== -1 || low.indexOf('.mp3') !== -1) audioOnly.push(uu);
        else if (low.indexOf('original') === 0) originalSrc.push(uu);
        else if (low.indexOf('video_') === 0) videoOnly.push(uu);
        else combined.push(uu);
      }
      function pickByBasename(urls, prefs) {
        for (var p = 0; p < prefs.length; p++) {
          for (var q = 0; q < urls.length; q++) {
            var pp = urls[q].split('?')[0];
            var ff = pp.substring(pp.lastIndexOf('/') + 1);
            var bn = ff.split('.')[0];
            if (bn === prefs[p]) return urls[q];
          }
        }
        return null;
      }
      var audioPref = ['audio_aac_192', 'audio_aac_128', 'audio_aac_64', 'audio'];
      var combinedPref = ['h264_360', 'h264_540', 'h264_180', 'h264_720', 'h264_1080', 'h264_1080_best'];
      var pickedAudio = pickByBasename(audioOnly, audioPref) || audioOnly[0];
      var pickedCombined = pickByBasename(combined, combinedPref) || combined[0];
      var pickedVideoOnly = pickByBasename(videoOnly, ['video_h264_360', 'video_h264_540', 'video_h264_180', 'video_h264_720', 'video_h264_1080']) || videoOnly[0];
      var best = pickedAudio || originalSrc[0] || pickedCombined || pickedVideoOnly || all[0] || null;
      resolve({ videoUrl: best, audioCount: audioOnly.length, combinedCount: combined.length, originalCount: originalSrc.length, videoOnlyCount: videoOnly.length, totalCount: all.length, sample: all.slice(0, 12) });
    }, 22000);
  });
};

export function apifyActorInput(assetUrl) {
  const preNavigationHooks = '[async (crawlingContext) => { await crawlingContext.page.evaluateOnNewDocument(' + injectedInterceptor.toString() + '); }]';
  return {
    startUrls: [{ url: assetUrl }],
    maxRequestsPerCrawl: 1,
    preNavigationHooks,
    pageFunction: pageFunctionBody.toString(),
    proxyConfiguration: { useApifyProxy: true },
  };
}

// n8n "Extract Video URL".
export function mediaUrlFromApify(items) {
  const first = Array.isArray(items) ? items[0] : null;
  if (!first || !first.videoUrl) return '';
  return String(first.videoUrl).replace(/&amp;/g, '&');
}
