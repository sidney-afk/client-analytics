import React from 'react';
import {theme} from './theme';

// Static recreation of the Create Linear Issue form from index.html.
// Every visual state is driven by props so scenes can animate it frame by frame.

const label: React.CSSProperties = {
  fontSize: 14.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: theme.textMuted,
  marginBottom: 8,
};

const inputBase: React.CSSProperties = {
  width: '100%',
  padding: '14px 18px',
  borderRadius: 12,
  border: `2px solid ${theme.border}`,
  background: theme.white,
  fontSize: 17,
  fontWeight: 500,
  color: theme.textPrimary,
  boxSizing: 'border-box',
  minHeight: 52,
  display: 'flex',
  alignItems: 'center',
};

export const Field: React.FC<{
  name: string;
  children: React.ReactNode;
  highlight?: number; // 0..1 glow strength
  badge?: string;
}> = ({name, children, highlight = 0, badge}) => (
  <div style={{display: 'flex', flexDirection: 'column', position: 'relative'}}>
    <div style={{...label, display: 'flex', alignItems: 'center', gap: 10}}>
      {name}
      {badge ? (
        <span
          style={{
            background: theme.upBg,
            color: theme.up,
            borderRadius: 7,
            padding: '3px 10px',
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: '0.05em',
          }}
        >
          {badge}
        </span>
      ) : null}
    </div>
    <div
      style={{
        borderRadius: 12,
        boxShadow: highlight > 0 ? `0 0 0 ${3 * highlight}px rgba(108,99,255,${0.35 * highlight})` : 'none',
      }}
    >
      {children}
    </div>
  </div>
);

export const TextInput: React.FC<{
  value: string;
  placeholder: string;
  focused?: boolean;
  flash?: number; // 0..1 paste flash
}> = ({value, placeholder, focused = false, flash = 0}) => (
  <div
    style={{
      ...inputBase,
      borderColor: focused ? '#aaa' : theme.border,
      background:
        flash > 0 ? `rgba(167,139,250,${0.18 * flash})` : theme.white,
      color: value ? theme.textPrimary : theme.textMuted,
      fontWeight: value ? 500 : 400,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}
  >
    {value || placeholder}
    {focused ? <Caret /> : null}
  </div>
);

const Caret: React.FC = () => (
  <span
    style={{
      display: 'inline-block',
      width: 2,
      height: 22,
      background: theme.textPrimary,
      marginLeft: 2,
    }}
  />
);

export const ClientSearch: React.FC<{
  value: string;
  ghost?: string;
  focused?: boolean;
  dropdownItems?: string[];
  hoveredItem?: number;
}> = ({value, ghost, focused = false, dropdownItems = [], hoveredItem = -1}) => (
  <div style={{position: 'relative'}}>
    <div
      style={{
        ...inputBase,
        borderRadius: 99,
        borderColor: focused ? '#aaa' : theme.border,
        boxShadow: focused ? '0 2px 10px rgba(0,0,0,0.07)' : 'none',
        color: value ? theme.textPrimary : theme.textMuted,
        fontWeight: value ? 600 : 400,
      }}
    >
      <span>{value || (focused ? '' : 'Search clients…')}</span>
      {ghost ? <span style={{color: theme.textMuted, fontWeight: 400}}>{ghost}</span> : null}
      {focused ? <Caret /> : null}
    </div>
    {dropdownItems.length > 0 ? (
      <div
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: 0,
          right: 0,
          background: theme.white,
          borderRadius: 14,
          boxShadow: '0 10px 36px rgba(0,0,0,0.14)',
          padding: 8,
          zIndex: 20,
        }}
      >
        {dropdownItems.map((item, i) => (
          <div
            key={item}
            style={{
              padding: '11px 16px',
              borderRadius: 9,
              fontSize: 16.5,
              fontWeight: 600,
              color: theme.textPrimary,
              background: i === hoveredItem ? theme.bg : 'transparent',
            }}
          >
            {item}
          </div>
        ))}
      </div>
    ) : null}
  </div>
);

export const TitleDisplay: React.FC<{value: string}> = ({value}) => (
  <div
    style={{
      ...inputBase,
      border: `2px solid ${theme.borderLight}`,
      background: theme.bg,
      fontWeight: value ? 600 : 400,
      fontStyle: value ? 'normal' : 'italic',
      color: value ? theme.textPrimary : theme.textMuted,
    }}
  >
    {value || 'Select a client to generate the title'}
  </div>
);

export type VideoCardState = {
  main: string;
  side: string;
  audio: string;
  mainFlash?: number;
  sideFlash?: number;
  audioFlash?: number;
  focusedField?: 'main' | 'side' | 'audio' | null;
};

export const VideoCard: React.FC<{num: number; state: VideoCardState}> = ({num, state}) => (
  <div
    style={{
      background: theme.white,
      border: `2px solid ${theme.border}`,
      borderRadius: 14,
      padding: '18px 20px 30px',
      position: 'relative',
    }}
  >
    <div style={{fontSize: 16, fontWeight: 700, marginBottom: 12}}>Video {num}</div>
    <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
      <TextInput
        value={state.main}
        placeholder="Main camera link"
        flash={state.mainFlash ?? 0}
        focused={state.focusedField === 'main'}
      />
      <TextInput
        value={state.side}
        placeholder="Side camera link"
        flash={state.sideFlash ?? 0}
        focused={state.focusedField === 'side'}
      />
      <TextInput
        value={state.audio}
        placeholder="Audio link"
        flash={state.audioFlash ?? 0}
        focused={state.focusedField === 'audio'}
      />
    </div>
    <span
      style={{
        position: 'absolute',
        bottom: 8,
        left: 22,
        fontSize: 13,
        color: theme.textMuted,
        fontWeight: 500,
      }}
    >
      ⇧ Shift — paste last link
    </span>
  </div>
);

export const AddVideoButton: React.FC<{hovered?: boolean}> = ({hovered = false}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 20px',
      borderRadius: 12,
      border: `2px dashed ${hovered ? '#aaa' : theme.border}`,
      background: hovered ? theme.white : 'transparent',
      fontSize: 16,
      fontWeight: 600,
      color: hovered ? theme.textSecondary : theme.textMuted,
      alignSelf: 'flex-start',
    }}
  >
    <svg width={14} height={14} viewBox="0 0 12 12" fill="none">
      <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    Add Video
  </div>
);

export const SubmitButton: React.FC<{pressed?: number}> = ({pressed = 0}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 14,
      padding: '16px 32px',
      borderRadius: 12,
      background: pressed > 0.5 ? '#333' : theme.textPrimary,
      color: theme.white,
      alignSelf: 'flex-start',
      transform: `scale(${1 - 0.04 * pressed})`,
    }}
  >
    <svg width={18} height={18} viewBox="0 0 16 16" fill="none">
      <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 9L9 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 14L14 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <span style={{display: 'flex', flexDirection: 'column', lineHeight: 1.2}}>
      <span style={{fontSize: 18.5, fontWeight: 700}}>Create Linears</span>
      <span style={{fontSize: 13, fontWeight: 500, opacity: 0.65, marginTop: 2}}>
        Video + graphic issue
      </span>
    </span>
  </div>
);

export const SuccessBanner: React.FC<{opacity: number}> = ({opacity}) => (
  <div
    style={{
      background: theme.upBg,
      border: `2px solid ${theme.up}`,
      color: theme.up,
      borderRadius: 12,
      padding: '14px 20px',
      fontSize: 17,
      fontWeight: 700,
      marginBottom: 22,
      opacity,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}
  >
    <svg width={20} height={20} viewBox="0 0 20 20">
      <circle cx={10} cy={10} r={9} fill={theme.up} />
      <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    Issue created in Linear!
  </div>
);
