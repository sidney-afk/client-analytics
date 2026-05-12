/* global React, ReactDOM */
function App() {
  const [screen, setScreen] = React.useState('dashboard');
  const [clientId, setClientId] = React.useState(null);
  const [frame, setFrame] = React.useState(null);
  const [format, setFormat] = React.useState('reels'); // reels (9:16) | youtube (16:9) | square (1:1)
  const [tick, setTick] = React.useState(0); // forces re-read of CLIENT_PROFILES after creator save

  // Load persisted profiles on mount
  React.useEffect(() => {
    window.CLIENT_PROFILES = window.loadProfiles();
    setTick(t => t + 1);
  }, []);

  const nav = (next, cid, f, fmt) => {
    setScreen(next);
    if (cid !== undefined) setClientId(cid);
    if (f !== undefined) setFrame(f);
    if (fmt !== undefined) setFormat(fmt);
    // Reload profiles in case creator just saved
    window.CLIENT_PROFILES = window.loadProfiles();
    setTick(t => t + 1);
    document.querySelector('.main')?.scrollTo({ top: 0 });
  };

  let body = null;
  if (screen === 'dashboard') body = <window.Dashboard onNav={nav} key={'d' + tick} />;
  else if (screen === 'new') body = <window.NewThumbnail onNav={nav} preselectedClient={clientId} format={format} setFormat={setFormat} />;
  else if (screen === 'picker') body = <window.FramePicker onNav={nav} clientId={clientId} format={format} />;
  else if (screen === 'editor') body = <window.Editor onNav={nav} clientId={clientId} frame={frame} format={format} />;
  else if (screen === 'create-profile') body = <window.CreateProfile onNav={nav} editingId={clientId} />;

  return (
    <div className="app">
      <window.Sidebar screen={screen} onNav={nav} currentClient={clientId} />
      <main className="main" data-screen-label={screen}>
        {body}
      </main>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
