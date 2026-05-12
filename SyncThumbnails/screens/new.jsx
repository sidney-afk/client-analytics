/* global React */
function NewThumbnail({ onNav, preselectedClient, format, setFormat }) {
  const [url, setUrl] = React.useState('');
  const [clientId, setClientId] = React.useState(preselectedClient || null);
  const [linkStatus, setLinkStatus] = React.useState('idle'); // idle | checking | valid | invalid

  const FORMATS = [
    { id: 'reels', label: 'Reels / Shorts / TikTok', ratio: '9:16', size: '1080×1920' },
    { id: 'youtube', label: 'YouTube', ratio: '16:9', size: '1280×720' },
    { id: 'square', label: 'Instagram feed', ratio: '1:1', size: '1080×1080' },
  ];

  React.useEffect(() => {
    if (preselectedClient) setClientId(preselectedClient);
  }, [preselectedClient]);

  React.useEffect(() => {
    if (!url) { setLinkStatus('idle'); return; }
    setLinkStatus('checking');
    const t = setTimeout(() => {
      const isDrive = /drive\.google\.com|frame\.io/i.test(url);
      setLinkStatus(isDrive ? 'valid' : 'invalid');
    }, 500);
    return () => clearTimeout(t);
  }, [url]);

  const canSubmit = linkStatus === 'valid' && clientId;
  const profiles = window.CLIENT_PROFILES;

  return (
    <div className="main-inner">
      <div className="steps">
        <span className="crumb active">01 Source</span>
        <span className="sep">→</span>
        <span className="crumb">02 Pick frame</span>
        <span className="sep">→</span>
        <span className="crumb">03 Render</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New thumbnail</h1>
          <p className="page-sub">Paste a Drive link — we read frames directly, no upload.</p>
        </div>
      </div>

      <div className="new-form">
        <div className="field">
          <label className="field-label">VIDEO SOURCE</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              placeholder="https://drive.google.com/file/d/..."
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
            <div style={{
              position: 'absolute',
              right: 12, top: '50%', transform: 'translateY(-50%)',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: linkStatus === 'valid' ? 'var(--success)' :
                     linkStatus === 'invalid' ? 'var(--danger)' :
                     linkStatus === 'checking' ? 'var(--text-dim)' : 'var(--text-faint)',
            }}>
              {linkStatus === 'idle' && 'drive · frame.io'}
              {linkStatus === 'checking' && 'checking…'}
              {linkStatus === 'valid' && '✓ readable'}
              {linkStatus === 'invalid' && 'unsupported'}
            </div>
          </div>
          {linkStatus === 'valid' && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              file: tutorial-rough-cut-v3.mp4 · 4.8 GB · we'll read ~38 MB
            </div>
          )}
        </div>

        <div className="field">
          <label className="field-label">OUTPUT FORMAT</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {FORMATS.map(f => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={"profile-tile " + (format === f.id ? 'selected' : '')}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '14px 14px 12px' }}
              >
                <div style={{
                  background: format === f.id ? 'var(--accent)' : 'var(--surface-3)',
                  width: f.id === 'reels' ? 22 : f.id === 'youtube' ? 44 : 30,
                  height: f.id === 'reels' ? 40 : f.id === 'youtube' ? 25 : 30,
                  borderRadius: 3,
                  transition: 'background 120ms',
                }}></div>
                <div>
                  <div className="pt-name">{f.ratio}</div>
                  <div className="pt-sub">{f.size}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">CLIENT PROFILE</label>
          <div className="profile-picker">
            {profiles.map(p => (
              <button
                key={p.id}
                className={"profile-tile " + (clientId === p.id ? 'selected' : '')}
                onClick={() => setClientId(p.id)}
              >
                <div className="swatch" style={{
                  background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})`,
                  border: `1px solid ${p.colors[2]}`,
                }}></div>
                <div style={{ flex: 1 }}>
                  <div className="pt-name">{p.name}</div>
                  <div className="pt-sub">{p.style} · {p.font}</div>
                </div>
                <div className="color-strip">
                  {p.colors.map((c, i) => (
                    <div key={i} className="swatch-mini" style={{ background: c }}></div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onNav('picker', clientId)}
          >
            Extract candidate frames
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
          <button className="btn btn-ghost" onClick={() => onNav('dashboard')}>Cancel</button>
        </div>

        <div style={{
          marginTop: 16,
          padding: 14,
          background: 'var(--surface)',
          border: '1px solid var(--border-soft)',
          borderRadius: 'var(--r)',
          fontSize: 12,
          color: 'var(--text-dim)',
          lineHeight: 1.6,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>HOW THIS WORKS</div>
          We send the Drive URL to a Modal function with ffmpeg. It range-reads ~30 MB of your 5 GB file, samples 1 frame/second, scores them for face size, expression, and sharpness, and returns the top 9. You never upload anything.
        </div>
      </div>
    </div>
  );
}

window.NewThumbnail = NewThumbnail;
