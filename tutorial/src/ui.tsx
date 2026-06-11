import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {theme} from './theme';

// ---------- typewriter ----------
export const typed = (
  text: string,
  frame: number,
  startFrame: number,
  charsPerFrame = 0.45,
): string => {
  if (frame < startFrame) return '';
  const n = Math.min(text.length, Math.floor((frame - startFrame) * charsPerFrame));
  return text.slice(0, n);
};

// ---------- animated cursor ----------
export type CursorWaypoint = {frame: number; x: number; y: number; click?: boolean};

export const Cursor: React.FC<{waypoints: CursorWaypoint[]}> = ({waypoints}) => {
  const frame = useCurrentFrame();
  if (waypoints.length === 0) return null;
  const frames = waypoints.map((w) => w.frame);
  const x = interpolate(frame, frames, waypoints.map((w) => w.x), {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const y = interpolate(frame, frames, waypoints.map((w) => w.y), {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  // click ripple: expands for 18 frames after any waypoint marked click
  const ripples = waypoints
    .filter((w) => w.click)
    .map((w) => {
      const t = frame - w.frame;
      if (t < 0 || t > 18) return null;
      const r = interpolate(t, [0, 18], [8, 34]);
      const o = interpolate(t, [0, 18], [0.45, 0]);
      return {x: w.x, y: w.y, r, o};
    })
    .filter(Boolean) as {x: number; y: number; r: number; o: number}[];

  return (
    <>
      {ripples.map((rp, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: rp.x - rp.r,
            top: rp.y - rp.r,
            width: rp.r * 2,
            height: rp.r * 2,
            borderRadius: '50%',
            border: `3px solid ${theme.accent}`,
            opacity: rp.o,
            pointerEvents: 'none',
          }}
        />
      ))}
      <svg
        width={30}
        height={30}
        viewBox="0 0 24 24"
        style={{
          position: 'absolute',
          left: x,
          top: y,
          filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.35))',
          pointerEvents: 'none',
          zIndex: 100,
        }}
      >
        <path
          d="M5.5 3.2L19 11.4l-6 1.2-3.2 5.4z"
          fill="#111110"
          stroke="#ffffff"
          strokeWidth={1.4}
        />
      </svg>
    </>
  );
};

// ---------- browser chrome ----------
export const BrowserChrome: React.FC<{
  url: string;
  width: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({url, width, children, style}) => (
  <div
    style={{
      width,
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 24px 70px rgba(0,0,0,0.18)',
      background: theme.white,
      ...style,
    }}
  >
    <div
      style={{
        height: 52,
        background: '#ececea',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 14,
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <div style={{display: 'flex', gap: 8}}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{width: 13, height: 13, borderRadius: '50%', background: c}} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          maxWidth: 560,
          margin: '0 auto',
          background: theme.white,
          borderRadius: 8,
          padding: '7px 16px',
          fontSize: 16,
          color: theme.textSecondary,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {url}
      </div>
      <div style={{width: 60}} />
    </div>
    {children}
  </div>
);

// ---------- bottom caption (subtitle, mirrors the voiceover) ----------
export const Caption: React.FC<{
  text: string;
  from: number;
  to: number;
}> = ({text, from, to}) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  const opacity = interpolate(
    frame,
    [from, from + 12, to - 12, to],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const rise = interpolate(frame, [from, from + 12], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 54,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          background: 'rgba(17,17,16,0.88)',
          color: theme.white,
          borderRadius: 14,
          padding: '14px 28px',
          fontSize: 27,
          fontWeight: 600,
          maxWidth: 1300,
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        {text}
      </div>
    </div>
  );
};

// ---------- folder / file icons ----------
export const FolderIcon: React.FC<{size?: number; filled?: boolean; dimmed?: boolean}> = ({
  size = 30,
  filled = false,
  dimmed = false,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{opacity: dimmed ? 0.35 : 1}}>
    <path
      d="M3 6.5C3 5.7 3.7 5 4.5 5h5l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
      fill={filled ? theme.accentLight : '#f3f0ff'}
      stroke={filled ? theme.accent : '#a99fe8'}
      strokeWidth={1.4}
    />
  </svg>
);

export const ClipIcon: React.FC<{size?: number; audio?: boolean}> = ({size = 26, audio = false}) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <rect x={4} y={3} width={16} height={18} rx={2.5} fill="#fbfaff" stroke="#a99fe8" strokeWidth={1.3} />
    {audio ? (
      <g stroke={theme.accent} strokeWidth={1.6} strokeLinecap="round">
        <line x1={8} y1={10} x2={8} y2={14} />
        <line x1={11} y1={8} x2={11} y2={16} />
        <line x1={14} y1={10} x2={14} y2={14} />
        <line x1={17} y1={9} x2={17} y2={15} />
      </g>
    ) : (
      <path d="M10 8.5v7l6-3.5z" fill={theme.accent} />
    )}
  </svg>
);
