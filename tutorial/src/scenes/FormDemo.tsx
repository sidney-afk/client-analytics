import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme} from '../theme';
import {FORM} from '../timeline';
import {BrowserChrome, Caption, Cursor, typed} from '../ui';
import {
  AddVideoButton,
  ClientSearch,
  Field,
  SubmitButton,
  SuccessBanner,
  TextInput,
  TitleDisplay,
  VideoCard,
} from '../form';

const CLIENT = 'Chelsey Scaffidi';
const TITLE = 'Chelsey Scaffidi · 11 Jun 2026';
const DRIVE_LINK = 'https://drive.google.com/drive/folders/1onmZ7EeHn9uswf_TC…';
const MAIN_LINK = 'https://drive.google.com/file/d/1aB3…  (Main Camera clip)';
const SIDE_LINK = 'https://drive.google.com/file/d/1cD4…  (Side Camera clip)';
const AUDIO_LINK = 'https://drive.google.com/file/d/1eF5…  (Audio file)';

const BROWSER_W = 1100;
const BROWSER_LEFT = (1920 - BROWSER_W) / 2;
const BROWSER_TOP = 70;
const VIEWPORT_H = 840;

// paste flash: 1 right after `at`, decays over 25 frames
const flash = (frame: number, at: number) =>
  frame < at ? 0 : Math.max(0, 1 - (frame - at) / 25);

const CAPTIONS: [string, number, number][] = [
  ['Then open your SyncView submission link.', 0, FORM.client - 10],
  ['Start typing your name in Client, and pick it from the list. The title fills in by itself.', FORM.client + 10, FORM.filming - 10],
  ['Filming Plans is handled automatically — you can skip right past it.', FORM.filming + 5, FORM.drive - 10],
  ['Paste the link to your main Drive folder into General Drive.', FORM.drive + 5, FORM.videos - 10],
  ['Now, for each video: paste the Main camera, Side camera, and Audio links from its script folder.', FORM.videos + 5, FORM.videos + 250],
  ['Tip — hold Shift and click to re-paste the last link you copied.', FORM.videos + 260, FORM.addVideo - 10],
  ['Filmed more than one script? Click Add Video and repeat.', FORM.addVideo + 5, FORM.submit - 10],
  ['When everything is in, hit Create Linears.', FORM.submit + 5, FORM.success - 5],
  ["And that's it — your videos are in our production queue.", FORM.success + 5, FORM.success + 120],
];

export const FormDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const slideIn = spring({frame, fps, config: {damping: 200}});

  // ---- client phase state ----
  const typeStart = FORM.client + 45;
  const clientTyped = typed('Chel', frame, typeStart, 0.18);
  const dropdownVisible = frame >= typeStart + 14 && frame < FORM.client + 180;
  const clientSelected = frame >= FORM.client + 180;
  const clientValue = clientSelected ? CLIENT : clientTyped;
  const ghost = !clientSelected && clientTyped.length >= 4 ? CLIENT.slice(clientTyped.length) : '';

  // ---- field values ----
  const drivePasteAt = FORM.drive + 70;
  const driveValue = frame >= drivePasteAt ? DRIVE_LINK : '';
  const mainPasteAt = FORM.videos + 60;
  const sidePasteAt = FORM.videos + 200;
  const audioPasteAt = FORM.videos + 340;
  const video2At = FORM.addVideo + 55;
  const submitPressAt = FORM.submit + 80;
  const showVideo2 = frame >= video2At;
  const video2In = spring({frame: frame - video2At, fps, config: {damping: 200}});

  const successOpacity = interpolate(frame, [FORM.success, FORM.success + 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // ---- scroll schedule (content translateY inside the browser viewport) ----
  const scrollY = interpolate(
    frame,
    [
      FORM.videos - 60,
      FORM.videos,
      FORM.addVideo - 40,
      FORM.addVideo,
      FORM.submit - 30,
      FORM.submit + 20,
      FORM.success,
      FORM.success + 35,
    ],
    [0, 470, 470, 560, 560, 900, 900, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: (t) => 1 - Math.pow(1 - t, 3),
    },
  );

  const fieldHighlight = (from: number, to: number) =>
    interpolate(frame, [from, from + 15, to - 15, to], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  return (
    <AbsoluteFill style={{background: theme.bg}}>
      <div
        style={{
          position: 'absolute',
          left: BROWSER_LEFT,
          top: BROWSER_TOP,
          opacity: slideIn,
          transform: `translateY(${(1 - slideIn) * 60}px)`,
        }}
      >
        <BrowserChrome url="syncview.synchrosocial.com — your submission link" width={BROWSER_W}>
          <div style={{height: VIEWPORT_H, overflow: 'hidden', background: theme.bg, position: 'relative'}}>
            <div
              style={{
                transform: `translateY(${-scrollY}px)`,
                padding: '44px 0 60px',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <div style={{width: 700, display: 'flex', flexDirection: 'column', gap: 22}}>
                {frame >= FORM.success ? <SuccessBanner opacity={successOpacity} /> : null}
                <div>
                  <div style={{fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em'}}>
                    Create Linear Issue
                  </div>
                  <div style={{fontSize: 17, color: theme.textSecondary, marginTop: 6}}>
                    Submit a video production task to Linear
                  </div>
                </div>

                <Field name="Client" highlight={fieldHighlight(FORM.client, FORM.filming - 20)}>
                  <ClientSearch
                    value={clientValue}
                    ghost={ghost}
                    focused={frame >= FORM.client + 30 && !clientSelected}
                    dropdownItems={dropdownVisible ? [CLIENT, 'Chelsea Hotel Media'] : []}
                    hoveredItem={dropdownVisible && frame >= FORM.client + 130 ? 0 : -1}
                  />
                </Field>

                <Field name="Title">
                  <TitleDisplay value={clientSelected ? TITLE : ''} />
                </Field>

                <Field
                  name="Filming Plans"
                  badge={frame >= FORM.filming + 20 ? 'FILLED AUTOMATICALLY' : undefined}
                  highlight={fieldHighlight(FORM.filming, FORM.drive - 20)}
                >
                  <TextInput
                    value={frame >= FORM.filming + 20 ? 'https://docs.google.com/document/d/1zwmKVqdWXbXs…' : ''}
                    placeholder="Filming plans link…"
                  />
                </Field>

                <Field name="General Drive" highlight={fieldHighlight(FORM.drive, FORM.videos - 40)}>
                  <TextInput
                    value={driveValue}
                    placeholder="General drive link…"
                    focused={frame >= FORM.drive + 40 && frame < drivePasteAt}
                    flash={flash(frame, drivePasteAt)}
                  />
                </Field>

                <Field name="Notes">
                  <div
                    style={{
                      width: '100%',
                      minHeight: 100,
                      padding: '14px 18px',
                      borderRadius: 12,
                      border: `2px solid ${theme.border}`,
                      background: theme.white,
                      fontSize: 17,
                      color: theme.textMuted,
                      boxSizing: 'border-box',
                    }}
                  >
                    Additional notes… (optional)
                  </div>
                </Field>

                <Field name="Videos" highlight={fieldHighlight(FORM.videos, FORM.addVideo - 20)}>
                  <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
                    <VideoCard
                      num={1}
                      state={{
                        main: frame >= mainPasteAt ? MAIN_LINK : '',
                        side: frame >= sidePasteAt ? SIDE_LINK : '',
                        audio: frame >= audioPasteAt ? AUDIO_LINK : '',
                        mainFlash: flash(frame, mainPasteAt),
                        sideFlash: flash(frame, sidePasteAt),
                        audioFlash: flash(frame, audioPasteAt),
                        focusedField:
                          frame >= FORM.videos + 30 && frame < mainPasteAt
                            ? 'main'
                            : frame >= mainPasteAt + 60 && frame < sidePasteAt
                              ? 'side'
                              : frame >= sidePasteAt + 60 && frame < audioPasteAt
                                ? 'audio'
                                : null,
                      }}
                    />
                    {showVideo2 ? (
                      <div style={{opacity: video2In, transform: `translateY(${(1 - video2In) * 20}px)`}}>
                        <VideoCard
                          num={2}
                          state={{
                            main: frame >= video2At + 60 ? 'https://drive.google.com/file/d/1gH6…' : '',
                            side: '',
                            audio: frame >= video2At + 80 ? 'https://drive.google.com/file/d/1iJ7…' : '',
                            mainFlash: flash(frame, video2At + 60),
                            audioFlash: flash(frame, video2At + 80),
                          }}
                        />
                      </div>
                    ) : null}
                    <AddVideoButton hovered={frame >= FORM.addVideo + 20 && frame < video2At} />
                  </div>
                </Field>

                <div style={{marginTop: 8}}>
                  <SubmitButton
                    pressed={frame >= submitPressAt && frame < submitPressAt + 14 ? 1 : 0}
                  />
                </div>
              </div>
            </div>

          </div>
        </BrowserChrome>
      </div>

      <Cursor
        waypoints={[
          {frame: FORM.client - 20, x: 1500, y: 950},
          {frame: FORM.client + 25, x: 950, y: 330, click: true},
          {frame: FORM.client + 130, x: 950, y: 330},
          {frame: FORM.client + 165, x: 930, y: 425},
          {frame: FORM.client + 180, x: 930, y: 425, click: true},
          {frame: FORM.filming + 10, x: 950, y: 516},
          {frame: FORM.drive + 20, x: 950, y: 530},
          {frame: FORM.drive + 55, x: 950, y: 618, click: true},
          {frame: FORM.videos - 60, x: 950, y: 618},
          {frame: FORM.videos + 20, x: 950, y: 455, click: true},
          {frame: mainPasteAt + 50, x: 950, y: 455},
          {frame: mainPasteAt + 80, x: 950, y: 519, click: true},
          {frame: sidePasteAt + 50, x: 950, y: 519},
          {frame: sidePasteAt + 80, x: 950, y: 583, click: true},
          {frame: FORM.addVideo - 30, x: 950, y: 583},
          {frame: FORM.addVideo + 35, x: 700, y: 591, click: true},
          {frame: FORM.submit - 20, x: 700, y: 591},
          {frame: submitPressAt, x: 723, y: 622, click: true},
          {frame: FORM.success + 20, x: 1450, y: 950},
        ]}
      />

      {CAPTIONS.map(([text, from, to]) => (
        <Caption key={text} text={text} from={from} to={to} />
      ))}
    </AbsoluteFill>
  );
};
