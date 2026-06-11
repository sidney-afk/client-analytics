import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme';

const ITEMS = [
  'Organize Drive: one folder per script — Main Camera, Side Camera, Audio',
  'Pick your name under Client',
  'Paste your General Drive link',
  'Paste the three links for each video',
  'Hit Create Linears — we take it from there',
];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const titleIn = spring({frame, fps, config: {damping: 200}});
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{background: theme.bg, justifyContent: 'center', alignItems: 'center', opacity: fadeOut}}
    >
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          marginBottom: 50,
          opacity: titleIn,
        }}
      >
        That's the whole flow
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 18, width: 1080}}>
        {ITEMS.map((item, i) => {
          const at = 20 + i * 26;
          const p = spring({frame: frame - at, fps, config: {damping: 200}});
          if (frame < at) return null;
          return (
            <div
              key={item}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                background: theme.white,
                borderRadius: 14,
                padding: '17px 26px',
                boxShadow: '0 5px 18px rgba(0,0,0,0.06)',
                opacity: p,
                transform: `translateX(${(1 - p) * -30}px)`,
              }}
            >
              <svg width={26} height={26} viewBox="0 0 20 20" style={{flexShrink: 0}}>
                <circle cx={10} cy={10} r={9} fill={theme.up} />
                <path
                  d="M6 10.5l2.5 2.5L14 7.5"
                  stroke="#fff"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span style={{fontSize: 27, fontWeight: 600}}>{item}</span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 50,
          fontSize: 25,
          fontWeight: 600,
          color: theme.textSecondary,
          opacity: spring({frame: frame - 160, fps, config: {damping: 200}}),
        }}
      >
        Questions? Just message us — happy to help.
      </div>
    </AbsoluteFill>
  );
};
