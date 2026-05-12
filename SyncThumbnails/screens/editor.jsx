/* global React */
function Editor({ onNav, clientId, frame, format }) {
  const profile = window.CLIENT_PROFILES.find(p => p.id === clientId) || window.CLIENT_PROFILES[0];
  const [headline, setHeadline] = React.useState('I cooked at 4am for 30 days');
  const [layout, setLayout] = React.useState(profile.layouts[0]);
  const [accentColor, setAccentColor] = React.useState(profile.colors[0]);
  const canvasRef = React.useRef(null);
  const imgRef = React.useRef(null);

  const frameImg = frame?.img || window.SMART_PICKS[0].img;

  // Canvas dimensions per format
  const dims = format === 'reels'
    ? { W: 1080, H: 1920, ratio: '9 / 16', label: '1080 × 1920 · Reels 9:16' }
    : format === 'square'
    ? { W: 1080, H: 1080, ratio: '1 / 1', label: '1080 × 1080 · Square 1:1' }
    : { W: 1280, H: 720, ratio: '16 / 9', label: '1280 × 720 · YouTube 16:9' };

  // Load Google Font dynamically
  React.useEffect(() => {
    if (!profile.fontUrl) return;
    const id = 'gf-' + profile.id;
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = profile.fontUrl;
      document.head.appendChild(link);
    }
  }, [profile]);

  // Render thumbnail to canvas
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = dims.W, H = dims.H;
    canvas.width = W;
    canvas.height = H;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Background image (cover)
      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth) {
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const canvasRatio = W / H;
        let dw, dh, dx, dy;
        if (imgRatio > canvasRatio) {
          dh = H; dw = H * imgRatio; dx = (W - dw) / 2; dy = 0;
        } else {
          dw = W; dh = W / imgRatio; dx = 0; dy = (H - dh) / 2;
        }
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, W, H);
      }

      // Dim layer to ensure text legibility
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Headline rendering based on layout
      // Scale text relative to canvas height for consistent presence across formats
      const baseFont = Math.round(H * 0.11);
      ctx.font = `800 ${baseFont}px "${profile.font}", sans-serif`;
      ctx.textBaseline = 'alphabetic';

      const drawTextBlock = (text, x, y, maxWidth, fontSize, bg, fg) => {
        ctx.font = `800 ${fontSize}px "${profile.font}", sans-serif`;
        const words = text.toUpperCase().split(' ');
        const lines = [];
        let current = '';
        words.forEach(w => {
          const test = current ? current + ' ' + w : w;
          if (ctx.measureText(test).width > maxWidth && current) {
            lines.push(current);
            current = w;
          } else {
            current = test;
          }
        });
        if (current) lines.push(current);

        const lineHeight = fontSize * 1.02;
        const padX = fontSize * 0.18;
        const padY = fontSize * 0.04;

        lines.forEach((line, i) => {
          const w = ctx.measureText(line).width;
          const yy = y + i * lineHeight;
          ctx.fillStyle = bg;
          ctx.fillRect(x - padX, yy - fontSize * 0.85 - padY, w + padX * 2, fontSize * 0.95 + padY * 2);
          ctx.fillStyle = fg;
          ctx.fillText(line, x, yy);
        });
      };

      const bgC = accentColor;
      const fgC = profile.colors[1] || '#FFFFFF';

      // Layout positions scale to canvas
      const pad = W * 0.06;
      if (layout === 'centered-bottom-twotone') {
        // Baya-style: white headline with last line in accent red, centered-bottom, no background.
        ctx.textAlign = 'center';
        const fontPx = Math.round(H * 0.062);
        ctx.font = `900 ${fontPx}px "${profile.font}", sans-serif`;
        const maxW = W * 0.85;
        const words = headline.split(' ');
        const lines = [];
        let cur = '';
        words.forEach(w => {
          const test = cur ? cur + ' ' + w : w;
          if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
          else cur = test;
        });
        if (cur) lines.push(cur);
        const lh = fontPx * 1.0;
        const totalH = lines.length * lh;
        const startY = H - H * 0.08 - totalH + fontPx;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        lines.forEach((line, i) => {
          ctx.fillStyle = (i === lines.length - 1) ? bgC : '#FFFFFF';
          ctx.fillText(line, W / 2, startY + i * lh);
        });
        ctx.shadowBlur = 0;
        ctx.textAlign = 'start';
      } else if (layout === 'big-text-left') {
        drawTextBlock(headline, pad, H * 0.32, W * 0.62, baseFont, bgC, fgC);
      } else if (layout === 'centered-bottom') {
        ctx.textAlign = 'center';
        drawTextBlock(headline, W / 2, H - H * 0.13, W * 0.85, baseFont * 0.95, bgC, fgC);
        ctx.textAlign = 'start';
      } else if (layout === 'split-screen') {
        // For vertical: top half color. For horizontal: left half.
        if (format === 'reels') {
          ctx.fillStyle = bgC;
          ctx.fillRect(0, 0, W, H * 0.42);
          drawTextBlock(headline, pad, H * 0.28, W * 0.85, baseFont, bgC, fgC);
        } else {
          ctx.fillStyle = bgC;
          ctx.fillRect(0, 0, W * 0.45, H);
          drawTextBlock(headline, pad, H / 2 + baseFont * 0.3, W * 0.4, baseFont * 0.9, bgC, fgC);
        }
      } else if (layout === 'top-strip') {
        const stripH = H * 0.18;
        ctx.fillStyle = bgC;
        ctx.fillRect(0, 0, W, stripH);
        ctx.fillStyle = fgC;
        const stripFont = Math.round(stripH * 0.45);
        ctx.font = `800 ${stripFont}px "${profile.font}", sans-serif`;
        ctx.fillText(headline.toUpperCase(), pad, stripH * 0.7);
      }
    };

    // wait for font + image
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(draw);
    }
    if (imgRef.current && imgRef.current.complete) draw();
    else if (imgRef.current) imgRef.current.onload = draw;

    // Re-draw on prop changes
    draw();
    const t = setTimeout(draw, 300);
    return () => clearTimeout(t);
  }, [headline, layout, accentColor, profile, frameImg, dims.W, dims.H, format]);

  const exportPng = () => {
    const canvas = canvasRef.current;
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `thumbnail-${profile.id}-${format}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    });
  };

  return (
    <div className="main-inner">
      <div className="steps">
        <span className="crumb done">01 Source</span>
        <span className="sep">→</span>
        <span className="crumb done">02 Pick frame</span>
        <span className="sep">→</span>
        <span className="crumb active">03 Render</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Edit</h1>
          <p className="page-sub">{profile.name} · {profile.font} · frame at {frame?.time || '00:00'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => onNav('picker', clientId)}>← Frame</button>
          <button className="btn btn-primary" onClick={exportPng}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export PNG · {dims.W}×{dims.H}
          </button>
        </div>
      </div>

      <div className="editor-grid">
        <div className="editor-canvas-wrap">
          <img ref={imgRef} src={frameImg} alt="" crossOrigin="anonymous" style={{ display: 'none' }} />
          <div style={{
            display: 'flex', justifyContent: 'center',
            background: '#000', borderRadius: 'var(--r)', padding: format === 'reels' ? '20px 0' : 0,
          }}>
            <canvas ref={canvasRef} className="editor-canvas" style={{
              aspectRatio: dims.ratio,
              width: format === 'reels' ? 'auto' : '100%',
              height: format === 'reels' ? '60vh' : 'auto',
              maxHeight: format === 'reels' ? 620 : 'none',
            }}></canvas>
          </div>
          <div className="editor-toolbar">
            <span>{dims.label}</span>
            <span>{profile.font} · {accentColor}</span>
          </div>
        </div>

        <div className="editor-panel">
          <div className="panel-section">
            <h4>Headline</h4>
            <textarea
              className="input"
              style={{ fontFamily: 'var(--font-sans)', resize: 'vertical', minHeight: 70 }}
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              maxLength={80}
            />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginTop: 6, textAlign: 'right' }}>
              {headline.length}/80
            </div>
          </div>

          <div className="panel-section">
            <h4>Layout</h4>
            <div className="layout-options">
              {profile.layouts.map(l => (
                <button
                  key={l}
                  className={"layout-tile " + (layout === l ? 'active' : '')}
                  onClick={() => setLayout(l)}
                  title={l}
                >
                  <LayoutPreview kind={l} color={accentColor} />
                </button>
              ))}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', marginTop: 8 }}>
              {layout}
            </div>
          </div>

          <div className="panel-section">
            <h4>Accent color</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              {profile.colors.map(c => (
                <button
                  key={c}
                  onClick={() => setAccentColor(c)}
                  style={{
                    width: 32, height: 32,
                    borderRadius: 6,
                    background: c,
                    border: accentColor === c ? '2px solid var(--text)' : '2px solid var(--border)',
                    cursor: 'pointer',
                  }}
                ></button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <h4>Brand assets</h4>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Font: <span style={{ color: 'var(--text)', fontFamily: profile.font }}>{profile.font}</span><br/>
              Style: <span style={{ color: 'var(--text)' }}>{profile.style}</span><br/>
              Logo: <span style={{ color: 'var(--text-faint)' }}>not set</span>
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 12, width: '100%', justifyContent: 'center', fontSize: 12 }}>
              Edit profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutPreview({ kind, color }) {
  if (kind === 'centered-bottom-twotone') {
    return (
      <>
        <div className="lt-bar" style={{ background: '#FFFFFF', left: '20%', right: '20%', bottom: '40%', height: 3 }}></div>
        <div className="lt-bar" style={{ background: color, left: '20%', right: '20%', bottom: '28%', height: 3 }}></div>
      </>
    );
  }
  if (kind === 'big-text-left') {
    return (
      <>
        <div className="lt-bar" style={{ background: color, left: 5, top: 14, width: 24, height: 4 }}></div>
        <div className="lt-bar" style={{ background: color, left: 5, top: 22, width: 18, height: 4 }}></div>
      </>
    );
  }
  if (kind === 'centered-bottom') {
    return <div className="lt-bar" style={{ background: color, left: '15%', right: '15%', bottom: 6, height: 4 }}></div>;
  }
  if (kind === 'split-screen') {
    return <div className="lt-bar" style={{ background: color, left: 0, top: 0, bottom: 0, width: '40%' }}></div>;
  }
  if (kind === 'top-strip') {
    return <div className="lt-bar" style={{ background: color, left: 0, right: 0, top: 0, height: 8 }}></div>;
  }
  return null;
}

window.Editor = Editor;
