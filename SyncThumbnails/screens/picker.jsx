/* global React */
function FramePicker({ onNav, clientId, format }) {
  const ratio = format === 'reels' ? '9 / 16' : format === 'square' ? '1 / 1' : '16 / 9';
  const [phase, setPhase] = React.useState('loading'); // loading | done
  const [progress, setProgress] = React.useState(0);
  const [stepIdx, setStepIdx] = React.useState(0);
  const [selectedFrame, setSelectedFrame] = React.useState(null);
  const [scrubTime, setScrubTime] = React.useState(0);

  const steps = [
    'Authenticating to Drive',
    'Reading file header (4 KB)',
    'Range-reading keyframes (~28 MB)',
    'Sampling 1 fps at 480p',
    'Scoring faces, expression, sharpness',
    'Ranking top 9 candidates',
  ];

  React.useEffect(() => {
    if (phase !== 'loading') return;
    let s = 0;
    const tick = () => {
      s += 1;
      setStepIdx(Math.min(s, steps.length - 1));
      setProgress(Math.min(100, (s / steps.length) * 100));
      if (s >= steps.length) {
        setTimeout(() => setPhase('done'), 400);
      } else {
        setTimeout(tick, 550 + Math.random() * 350);
      }
    };
    const t = setTimeout(tick, 400);
    return () => clearTimeout(t);
  }, [phase]);

  const picks = window.SMART_PICKS;
  const scrubFrame = picks[Math.floor((scrubTime / 100) * (picks.length - 1))];

  return (
    <div className="main-inner">
      <div className="steps">
        <span className="crumb done">01 Source</span>
        <span className="sep">→</span>
        <span className="crumb active">02 Pick frame</span>
        <span className="sep">→</span>
        <span className="crumb">03 Render</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Pick a frame</h1>
          <p className="page-sub">
            {phase === 'loading' ? 'Reading from Drive — this takes ~25 seconds.' : '9 candidates ranked by face, expression, and sharpness. Or scrub for your own.'}
          </p>
        </div>
        {phase === 'done' && (
          <button className="btn btn-ghost" onClick={() => onNav('new', clientId)}>← Source</button>
        )}
      </div>

      {phase === 'loading' && (
        <div className="loading-stage">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="spinner"></div>
            <div style={{ fontWeight: 500 }}>{steps[stepIdx]}</div>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
              {Math.round(progress)}%
            </div>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: progress + '%' }}></div>
          </div>
          <div className="progress-steps">
            {steps.map((s, i) => (
              <div key={i} className={"progress-step " + (i < stepIdx ? 'done' : i === stepIdx ? 'active' : '')}>
                <div className="marker">{i < stepIdx ? '✓' : ''}</div>
                <div>{s}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="picker-shell">
          <div>
            <h3 className="section-title">
              Smart picks
              <span className="count">9 candidates · scored 71–94</span>
            </h3>
            <div className="smart-picks" style={{ gridTemplateColumns: format === 'reels' ? 'repeat(5, 1fr)' : 'repeat(3, 1fr)' }}>
              {picks.map(p => (
                <div
                  key={p.id}
                  className={"pick-card " + (selectedFrame === p.id ? 'selected' : '')}
                  onClick={() => setSelectedFrame(p.id)}
                >
                  <img className="pick-img" src={p.img} alt="" style={{ aspectRatio: ratio }} />
                  <div className="pick-meta">
                    <div className="pick-badge">{p.time}</div>
                    <div className="pick-badge score">{p.score}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="section-title">
              Or pick manually
              <span className="count">scrub the timeline</span>
            </h3>
            <div className="scrubber-card">
              <div className="scrub-preview" style={{ aspectRatio: ratio, maxHeight: format === 'reels' ? 540 : 'none', margin: format === 'reels' ? '0 auto 16px' : '0 0 16px', width: format === 'reels' ? 'auto' : '100%' }}>
                <img src={scrubFrame.img} alt="" />
                <div className="scrub-time">{scrubFrame.time}</div>
              </div>
              <div className="scrub-controls">
                <button className="btn-quiet" style={{ padding: 6 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20"/></svg>
                </button>
                <div className="scrub-track">
                  <div className="scrub-rail">
                    <div className="scrub-thumb" style={{ left: scrubTime + '%' }}></div>
                  </div>
                  <input
                    type="range"
                    className="scrub-input"
                    min="0" max="100" value={scrubTime}
                    onChange={e => setScrubTime(Number(e.target.value))}
                  />
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', minWidth: 70, textAlign: 'right' }}>
                  {scrubFrame.time} / 12:34
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setSelectedFrame('scrub'); }}
                >
                  Use this frame
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              className="btn btn-primary"
              disabled={!selectedFrame}
              onClick={() => {
                const frame = selectedFrame === 'scrub' ? scrubFrame : picks.find(p => p.id === selectedFrame);
                onNav('editor', clientId, { img: frame.img, time: frame.time });
              }}
            >
              Continue to editor
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

window.FramePicker = FramePicker;
