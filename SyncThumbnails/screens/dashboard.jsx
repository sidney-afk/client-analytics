/* global React */
function Dashboard({ onNav }) {
  const thumbs = window.RECENT_THUMBS || [];
  const profiles = window.CLIENT_PROFILES || [];
  const empty = profiles.length === 0;

  if (empty) {
    return (
      <div className="main-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">SyncThumbnails</h1>
            <p className="page-sub">Set up your clients once — then pull frames + render thumbnails in 30 seconds.</p>
          </div>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: '48px 36px',
          textAlign: 'center',
          maxWidth: 640,
          margin: '40px auto',
        }}>
          <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Step 1 of 2
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 8px 0' }}>
            Create your first client profile
          </h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, margin: '0 auto 24px', maxWidth: 440 }}>
            Drop 3–5 of their existing thumbnails. We'll pull the colors automatically — you pick the font and layout style. Takes about 90 seconds per client.
          </p>
          <button className="btn btn-primary" onClick={() => onNav('create-profile', null)} style={{ padding: '12px 20px', fontSize: 14 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New client profile
          </button>
          <div style={{ marginTop: 36, paddingTop: 24, borderTop: '1px solid var(--border-soft)', fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            Plan: add all ~20 clients now → then use New thumbnail per video.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">Thumbnails</h1>
          <p className="page-sub">{profiles.length} client {profiles.length === 1 ? 'profile' : 'profiles'} · {thumbs.length} recent</p>
        </div>
        <button className="btn btn-primary" onClick={() => onNav('new')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New thumbnail
        </button>
      </div>

      {/* Client profile cards */}
      <h3 className="section-title">
        Client profiles
        <span className="count">{profiles.length}</span>
      </h3>
      <div className="profile-grid">
        {profiles.map(p => (
          <button key={p.id} className="profile-card" onClick={() => onNav('create-profile', p.id)}>
            <div className="profile-card-swatch">
              {p.colors.slice(0, 4).map((c, i) => (
                <div key={i} style={{ background: c, flex: 1 }}></div>
              ))}
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>
                {p.handle || '—'} · {p.font}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                {p.layouts.map(l => (
                  <div key={l} style={{
                    padding: '2px 6px', borderRadius: 4,
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    background: 'var(--surface-2)', color: 'var(--text-dim)',
                    border: '1px solid var(--border-soft)',
                  }}>{l.split('-')[0]}</div>
                ))}
              </div>
            </div>
          </button>
        ))}
        <button className="profile-card profile-add" onClick={() => onNav('create-profile', null)}>
          <div style={{ fontSize: 28, color: 'var(--text-faint)' }}>＋</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Add client</div>
        </button>
      </div>

      {thumbs.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: 36 }}>
            Recent thumbnails
            <span className="count">{thumbs.length}</span>
          </h3>
          <div className="thumb-grid">
            {thumbs.map(t => (
              <div className="thumb-card" key={t.id} onClick={() => onNav('editor', t.clientId, t, t.format)}>
                <div className="thumb-preview" style={{ aspectRatio: t.format === 'reels' ? '9 / 16' : t.format === 'square' ? '1 / 1' : '16 / 9' }}>
                  <img src={t.img} alt={t.headline} />
                </div>
                <div className="thumb-meta">
                  <div>
                    <div className="thumb-client">{t.client}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 2 }}>{t.headline}</div>
                  </div>
                  <div className="thumb-time">{t.time}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

window.Dashboard = Dashboard;
