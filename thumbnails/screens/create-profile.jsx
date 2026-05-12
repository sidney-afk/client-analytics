/* global React */
function CreateProfile({ onNav, editingId }) {
  const existing = editingId ? (window.CLIENT_PROFILES.find(p => p.id === editingId)) : null;

  const [name, setName] = React.useState(existing?.name || '');
  const [handle, setHandle] = React.useState(existing?.handle || '');
  const [samples, setSamples] = React.useState(existing?.samples || []); // [{ id, dataUrl }]
  const [palette, setPalette] = React.useState(existing?.colors || []);
  const [accentIdx, setAccentIdx] = React.useState(0);
  const [fontName, setFontName] = React.useState(existing?.font || 'Anton');
  const [layouts, setLayouts] = React.useState(existing?.layouts || ['big-text-left', 'centered-bottom']);
  const [style, setStyle] = React.useState(existing?.style || 'Reels');
  const [extracting, setExtracting] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const sampleImgRefs = React.useRef({});

  // Load all curated fonts for preview
  React.useEffect(() => {
    window.FONT_OPTIONS.forEach(f => {
      const id = 'gf-prev-' + f.name.replace(/\s+/g, '-');
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = f.url;
        document.head.appendChild(link);
      }
    });
  }, []);

  // Auto-extract palette when samples change
  React.useEffect(() => {
    if (samples.length === 0) { setPalette([]); return; }
    setExtracting(true);
    const t = setTimeout(() => {
      const colors = new Map();
      samples.forEach(s => {
        const img = sampleImgRefs.current[s.id];
        if (img && img.complete && img.naturalWidth) {
          try {
            const p = window.extractPalette(img, 4);
            p.forEach((c, i) => {
              colors.set(c, (colors.get(c) || 0) + (4 - i));
            });
          } catch (e) {}
        }
      });
      const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
      setPalette(sorted);
      setExtracting(false);
    }, 400);
    return () => clearTimeout(t);
  }, [samples]);

  const addFiles = (files) => {
    [...files].forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => {
        setSamples(prev => [...prev, { id: 's' + Date.now() + Math.random(), dataUrl: e.target.result }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeSample = (id) => {
    setSamples(prev => prev.filter(s => s.id !== id));
  };

  const toggleLayout = (id) => {
    setLayouts(prev => prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]);
  };

  const canSave = name && palette.length > 0 && layouts.length > 0;

  const save = () => {
    const id = existing?.id || (name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36).slice(-4));
    const fontObj = window.FONT_OPTIONS.find(f => f.name === fontName);
    const profile = {
      id, name, handle,
      colors: palette,
      accent: palette[accentIdx] || palette[0],
      font: fontName,
      fontUrl: fontObj?.url,
      style,
      layouts,
      samples,
      createdAt: Date.now(),
    };
    const all = window.loadProfiles();
    const idx = all.findIndex(p => p.id === id);
    if (idx >= 0) all[idx] = profile; else all.push(profile);
    window.saveProfiles(all);
    onNav('dashboard');
  };

  const remove = () => {
    if (!existing) return;
    if (!confirm(`Delete profile for ${existing.name}?`)) return;
    const all = window.loadProfiles().filter(p => p.id !== existing.id);
    window.saveProfiles(all);
    onNav('dashboard');
  };

  const onDrop = (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="main-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">{existing ? `Edit · ${existing.name}` : 'New client profile'}</h1>
          <p className="page-sub">Drop their existing thumbnails. We'll pull colors automatically — you pick the font.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {existing && <button className="btn btn-ghost" onClick={remove} style={{ color: 'var(--danger)' }}>Delete</button>}
          <button className="btn btn-ghost" onClick={() => onNav('dashboard')}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSave} onClick={save}>
            {existing ? 'Save changes' : 'Create profile'}
          </button>
        </div>
      </div>

      <div className="cp-grid">
        {/* LEFT: samples + extracted */}
        <div className="cp-col">
          <div className="panel-section">
            <h4>Sample thumbnails</h4>
            <div
              className="dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
            >
              {samples.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-dim)' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>＋</div>
                  <div>Drop thumbnails here</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    3–5 recommended · PNG, JPG
                  </div>
                </div>
              ) : (
                <div className="sample-grid">
                  {samples.map(s => (
                    <div key={s.id} className="sample-tile">
                      <img
                        src={s.dataUrl}
                        ref={el => { if (el) sampleImgRefs.current[s.id] = el; }}
                        crossOrigin="anonymous"
                      />
                      <button
                        className="sample-remove"
                        onClick={e => { e.stopPropagation(); removeSample(s.id); }}
                      >×</button>
                    </div>
                  ))}
                  <div className="sample-tile sample-add">＋</div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={e => addFiles(e.target.files)}
            />
          </div>

          <div className="panel-section">
            <h4>
              Extracted palette
              {extracting && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginLeft: 8 }}>extracting…</span>}
            </h4>
            {palette.length === 0 ? (
              <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>Drop thumbnails to extract colors.</div>
            ) : (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Click the color you want as primary accent. Drag to reorder (manually edit hex below).
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {palette.map((c, i) => (
                    <button
                      key={c + i}
                      onClick={() => setAccentIdx(i)}
                      style={{
                        width: 56, height: 56,
                        borderRadius: 8,
                        background: c,
                        border: accentIdx === i ? '3px solid var(--text)' : '2px solid var(--border)',
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                      title={c}
                    >
                      {accentIdx === i && <div style={{
                        position: 'absolute', bottom: -18, left: '50%', transform: 'translateX(-50%)',
                        fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
                      }}>accent</div>}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 28, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {palette.map((c, i) => (
                    <input
                      key={i}
                      className="input"
                      style={{ width: 90, padding: '6px 8px', fontSize: 11 }}
                      value={c}
                      onChange={e => {
                        const next = [...palette];
                        next[i] = e.target.value.toUpperCase();
                        setPalette(next);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: metadata */}
        <div className="cp-col">
          <div className="panel-section">
            <h4>Client</h4>
            <div className="field">
              <label className="field-label" style={{ fontSize: 11 }}>NAME</label>
              <input className="input" style={{ fontFamily: 'var(--font-sans)' }} placeholder="e.g. Mara Lin" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field-label" style={{ fontSize: 11 }}>HANDLE / NICKNAME</label>
              <input className="input" placeholder="@maralin.cooks" value={handle} onChange={e => setHandle(e.target.value)} />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field-label" style={{ fontSize: 11 }}>PRIMARY FORMAT</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Reels', 'YouTube', 'Mixed', 'Podcast'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className="btn-quiet"
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      background: style === s ? 'var(--accent-soft)' : 'var(--surface-2)',
                      color: style === s ? 'var(--accent)' : 'var(--text-dim)',
                      fontSize: 12,
                    }}
                  >{s}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="panel-section">
            <h4>Headline font</h4>
            <div className="font-list">
              {window.FONT_OPTIONS.map(f => (
                <button
                  key={f.name}
                  className={"font-row " + (fontName === f.name ? 'active' : '')}
                  onClick={() => setFontName(f.name)}
                >
                  <div style={{ fontFamily: `"${f.name}", sans-serif`, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>
                    {(name || 'Aa Bb Cc').toUpperCase().slice(0, 12)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{f.name}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{f.vibe}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <h4>Layout templates</h4>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
              Which positions does this client typically use? You can pick more than one.
            </div>
            <div className="layout-options">
              {window.LAYOUT_OPTIONS.map(l => (
                <button
                  key={l.id}
                  className={"layout-tile " + (layouts.includes(l.id) ? 'active' : '')}
                  onClick={() => toggleLayout(l.id)}
                  title={l.label}
                  style={{ aspectRatio: '9 / 12' }}
                >
                  <LayoutMini kind={l.id} color={palette[accentIdx] || '#888'} />
                  <div style={{
                    position: 'absolute', bottom: 4, left: 0, right: 0,
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: layouts.includes(l.id) ? 'var(--accent)' : 'var(--text-faint)',
                    textAlign: 'center',
                  }}>{l.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutMini({ kind, color }) {
  if (kind === 'big-text-left') {
    return <>
      <div className="lt-bar" style={{ background: color, left: 5, top: '40%', width: 26, height: 4 }}></div>
      <div className="lt-bar" style={{ background: color, left: 5, top: 'calc(40% + 7px)', width: 18, height: 4 }}></div>
    </>;
  }
  if (kind === 'centered-bottom') {
    return <div className="lt-bar" style={{ background: color, left: '20%', right: '20%', bottom: '18%', height: 5 }}></div>;
  }
  if (kind === 'split-screen') {
    return <div className="lt-bar" style={{ background: color, left: 0, right: 0, top: 0, height: '35%' }}></div>;
  }
  if (kind === 'top-strip') {
    return <div className="lt-bar" style={{ background: color, left: 0, right: 0, top: 0, height: 8 }}></div>;
  }
  return null;
}

window.CreateProfile = CreateProfile;
