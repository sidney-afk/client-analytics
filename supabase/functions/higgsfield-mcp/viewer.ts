// In-chat viewer (MCP Apps). Chat apps that support MCP Apps (Claude, and
// others) render this page in a sandboxed frame under a job-check tool call,
// so finished images and videos show in the conversation itself instead of
// only as links. The page gets the tool result over postMessage and reads the
// media links from structuredContent.
export const VIEWER_URI = "ui://synchro-higgsfield/preview.html";
export const VIEWER_MIME = "text/html;profile=mcp-app";
// Where results live: our uploads and Higgsfield's outputs (both CloudFront).
// resourceDomains covers img/media; connectDomains lets the page fetch a video
// itself when the host's media rules refuse to stream it directly.
export const VIEWER_CSP = { resourceDomains: ["https://*.cloudfront.net"], connectDomains: ["https://*.cloudfront.net"] };

export const VIEWER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px system-ui, sans-serif; background: transparent; }
  #media { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px; }
  #media img, #media video { max-width: 100%; max-height: 520px; border-radius: 8px; display: block; }
  #media a { display: block; }
  .one img, .one video { margin: 0 auto; }
  #empty { padding: 6px; opacity: .7; }
  .btn { display: inline-block; padding: 10px 16px; border-radius: 8px; background: #2d6cdf; color: #fff; text-decoration: none; font-weight: 600; }
</style></head>
<body><div id="media"></div><div id="empty"></div>
<script>
(function () {
  var nextId = 1, pending = {};
  function send(msg) { window.parent.postMessage(msg, "*"); }
  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve) { pending[id] = resolve; send({ jsonrpc: "2.0", id: id, method: method, params: params }); });
  }
  function notify(method, params) { send({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function resize() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: h });
  }
  function render(result) {
    var box = document.getElementById("media"), empty = document.getElementById("empty");
    var sc = (result && result.structuredContent) || {};
    var images = sc.images || [], videos = sc.videos || [];
    box.innerHTML = ""; empty.textContent = "";
    box.className = images.length + videos.length === 1 ? "one" : "";
    images.forEach(function (u) {
      var a = document.createElement("a"); a.href = u; a.target = "_blank"; a.rel = "noopener";
      var img = document.createElement("img"); img.src = u; img.alt = "Result"; img.onload = resize;
      a.appendChild(img); box.appendChild(a);
    });
    videos.forEach(function (u) {
      var wrap = document.createElement("div");
      var v = document.createElement("video"); v.controls = true; v.playsInline = true; v.loop = true; v.muted = true; v.preload = "metadata";
      v.onloadedmetadata = resize;
      var triedBlob = false;
      v.onerror = function () {
        // Direct streaming refused: fetch the file and play it from memory,
        // and if that fails too, fall back to a plain button.
        if (triedBlob) { fallback(); return; }
        triedBlob = true;
        fetch(u).then(function (r) { if (!r.ok) throw 0; return r.blob(); })
          .then(function (b) { v.src = URL.createObjectURL(b); v.load(); })
          .catch(fallback);
      };
      function fallback() {
        wrap.innerHTML = "";
        var a = document.createElement("a"); a.href = u; a.target = "_blank"; a.rel = "noopener";
        a.textContent = "\u25B6 Play the video"; a.className = "btn";
        wrap.appendChild(a); resize();
      }
      v.src = u; wrap.appendChild(v); box.appendChild(wrap);
    });
    if (!images.length && !videos.length) empty.textContent = sc.status || "";
    resize();
  }
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; return; }
    if (m.method === "ui/notifications/tool-result") render(m.params);
  });
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "synchro-higgsfield-viewer", version: "1.0.0" }
  }).then(function () { notify("ui/notifications/initialized"); resize(); });
})();
</script></body></html>`;
