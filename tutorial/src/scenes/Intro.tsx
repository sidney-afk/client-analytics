import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const titleIn = spring({frame: frame - 8, fps, config: {damping: 200}});
  const subIn = spring({frame: frame - 28, fps, config: {damping: 200}});
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: theme.accent,
          marginBottom: 28,
          opacity: titleIn,
        }}
      >
        SyncView
      </div>
      <div
        style={{
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: theme.textPrimary,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 40}px)`,
          textAlign: 'center',
        }}
      >
        Sending us your footage
      </div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 500,
          color: theme.textSecondary,
          marginTop: 24,
          opacity: subIn,
          transform: `translateY(${(1 - subIn) * 30}px)`,
        }}
      >
        Organize, upload, submit — in under two minutes.
      </div>
    </AbsoluteFill>
  );
};
