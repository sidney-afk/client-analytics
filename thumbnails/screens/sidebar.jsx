/* global React */
const { useState, useEffect, useRef } = React;

function Sidebar({ screen, onNav, currentClient }) {
  const profiles = window.CLIENT_PROFILES || [];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">S</div>
        <div className="brand-name">SyncThumbnails</div>
      </div>

      <div className="nav-section">
        <button
          className={"nav-item " + (screen === 'dashboard' ? 'active' : '')}
          onClick={() => onNav('dashboard')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Dashboard
        </button>
        <button
          className={"nav-item " + (screen === 'new' ? 'active' : '')}
          onClick={() => onNav('new')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New thumbnail
        </button>
      </div>

      <div className="nav-section" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Clients</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{profiles.length}</span>
        </div>
        {profiles.length === 0 && (
          <div style={{ padding: '8px 8px', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
            No clients yet.<br/>Create your first profile.
          </div>
        )}
        {profiles.map(p => (
          <button
            key={p.id}
            className={"nav-item " + (currentClient === p.id ? 'active' : '')}
            onClick={() => onNav('create-profile', p.id)}
          >
            <div className="dot" style={{ background: p.accent || '#888' }}></div>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          </button>
        ))}
        <button
          className="nav-item"
          style={{ color: 'var(--accent)', marginTop: 4 }}
          onClick={() => onNav('create-profile', null)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add client
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="avatar"></div>
        <div>
          <div style={{ color: 'var(--text)', fontWeight: 500 }}>You</div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>free · modal</div>
        </div>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
