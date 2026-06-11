import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme';
import {Caption, ClipIcon, FolderIcon} from '../ui';

const STEP_AT = [30, 180, 360, 540, 700];

const STEPS = [
  'One folder per script',
  'Three folders inside: Main Camera, Side Camera, Audio',
  'One clip per folder',
  'No side cam or audio? Skip that folder',
  'Keep the labels exact',
];

const CAPTIONS: [string, number, number][] = [
  ['Before you upload, organize your Google Drive like this.', 0, 170],
  ['Make one folder for each script you film.', 175, 350],
  ['Inside it, three folders: Main Camera, Side Camera, and Audio — one clip in each.', 355, 530],
  ["Didn't record a side cam or separate audio? Just leave that folder out.", 540, 690],
  ['And keep the folder names exactly like this, so our editors find everything instantly.', 700, 880],
];

const appear = (frame: number, at: number, fps: number) =>
  spring({frame: frame - at, fps, config: {damping: 200}});

const TreeRow: React.FC<{
  depth: number;
  icon: React.ReactNode;
  name: string;
  at: number;
  dimmed?: boolean;
  struck?: boolean;
  note?: string;
  glowAt?: number;
}> = ({depth, icon, name, at, dimmed, struck, note, glowAt}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = appear(frame, at, fps);
  if (frame < at) return null;
  const glow =
    glowAt !== undefined
      ? interpolate(frame, [glowAt, glowAt + 20], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        marginLeft: depth * 56,
        opacity: (dimmed ? 0.45 : 1) * p,
        transform: `translateX(${(1 - p) * -24}px)`,
        height: 45,
      }}
    >
      {icon}
      <span
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: theme.textPrimary,
          textDecoration: struck ? 'line-through' : 'none',
          background: glow > 0 ? `rgba(167,139,250,${0.3 * glow})` : 'transparent',
          borderRadius: 8,
          padding: '2px 10px',
          border: glow > 0 ? `2px solid rgba(108,99,255,${glow})` : '2px solid transparent',
        }}
      >
        {name}
      </span>
      {note ? (
        <span style={{fontSize: 21, fontWeight: 600, color: theme.textMuted, fontStyle: 'italic'}}>
          {note}
        </span>
      ) : null}
    </div>
  );
};

export const DriveOrg: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const [s1, s2, s3, s4, s5] = STEP_AT;

  return (
    <AbsoluteFill style={{background: theme.bg, opacity: fadeOut}}>
      <div
        style={{
          position: 'absolute',
          top: 70,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 52,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          color: theme.textPrimary,
          opacity: appear(frame, 0, fps),
        }}
      >
        Step 1 — Organize your footage in Drive
      </div>

      {/* left: step list */}
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 230,
          width: 720,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {STEPS.map((step, i) => {
          const p = appear(frame, STEP_AT[i], fps);
          const active = frame >= STEP_AT[i] && (i === 4 || frame < STEP_AT[i + 1]);
          if (frame < STEP_AT[i]) return null;
          return (
            <div
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                background: theme.white,
                borderRadius: 16,
                padding: '20px 26px',
                boxShadow: active
                  ? `0 0 0 3px rgba(108,99,255,0.45), 0 8px 26px rgba(0,0,0,0.08)`
                  : '0 4px 16px rgba(0,0,0,0.05)',
                opacity: p,
                transform: `translateY(${(1 - p) * 24}px)`,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: active ? theme.accent : '#e9e6ff',
                  color: active ? theme.white : theme.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{fontSize: 27, fontWeight: 700, color: theme.textPrimary, lineHeight: 1.3}}>
                {step}
              </div>
            </div>
          );
        })}
      </div>

      {/* right: folder tree */}
      <div
        style={{
          position: 'absolute',
          right: 120,
          top: 200,
          width: 660,
          background: theme.white,
          borderRadius: 20,
          padding: '26px 40px',
          boxShadow: '0 10px 36px rgba(0,0,0,0.07)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          opacity: appear(frame, s1, fps),
        }}
      >
        <TreeRow depth={0} icon={<FolderIcon filled size={36} />} name="Script 1" at={s1} glowAt={s5} />
        <TreeRow depth={1} icon={<FolderIcon size={32} />} name="Main Camera" at={s2} glowAt={s5 + 8} />
        <TreeRow depth={2} icon={<ClipIcon />} name="clip.mp4" at={s3} />
        <TreeRow depth={1} icon={<FolderIcon size={32} />} name="Side Camera" at={s2 + 14} glowAt={s5 + 16} />
        <TreeRow depth={2} icon={<ClipIcon />} name="clip.mp4" at={s3 + 14} />
        <TreeRow depth={1} icon={<FolderIcon size={32} />} name="Audio" at={s2 + 28} glowAt={s5 + 24} />
        <TreeRow depth={2} icon={<ClipIcon audio />} name="audio.wav" at={s3 + 28} />
        <div style={{height: 14}} />
        <TreeRow depth={0} icon={<FolderIcon filled size={36} />} name="Script 2" at={s4} glowAt={s5} />
        <TreeRow depth={1} icon={<FolderIcon size={32} />} name="Main Camera" at={s4 + 12} />
        <TreeRow depth={2} icon={<ClipIcon />} name="clip.mp4" at={s4 + 12} />
        <TreeRow
          depth={1}
          icon={<FolderIcon size={32} dimmed />}
          name="Side Camera"
          at={s4 + 26}
          dimmed
          struck
          note="no side cam — skipped"
        />
        <TreeRow depth={1} icon={<FolderIcon size={32} />} name="Audio" at={s4 + 40} />
        <TreeRow depth={2} icon={<ClipIcon audio />} name="audio.wav" at={s4 + 40} />
      </div>

      {CAPTIONS.map(([text, from, to]) => (
        <Caption key={text} text={text} from={from} to={to} />
      ))}
    </AbsoluteFill>
  );
};
