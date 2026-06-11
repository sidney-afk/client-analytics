import React from 'react';
import {AbsoluteFill, Audio, Composition, Series, staticFile} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {FPS, SCENES, TOTAL_FRAMES} from './timeline';
import {Intro} from './scenes/Intro';
import {DriveOrg} from './scenes/DriveOrg';
import {FormDemo} from './scenes/FormDemo';
import {Outro} from './scenes/Outro';

// Self-hosted (variable font, weights 400-800) because the render container
// cannot reach fonts.gstatic.com from inside the headless browser.
const fontFamily = 'Plus Jakarta Sans';
loadFont({
  family: fontFamily,
  url: staticFile('fonts/PlusJakartaSans-latin.woff2'),
  weight: '400 800',
});

// Flip to true once you've generated the ElevenLabs voiceover (see VOICEOVER.md)
// and dropped it into tutorial/public/voiceover.mp3.
const VOICEOVER_ENABLED = false;

const Tutorial: React.FC = () => (
  <AbsoluteFill style={{fontFamily}}>
    <Series>
      <Series.Sequence durationInFrames={SCENES.intro}>
        <Intro />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENES.driveOrg}>
        <DriveOrg />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENES.formDemo}>
        <FormDemo />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENES.outro}>
        <Outro />
      </Series.Sequence>
    </Series>
    {VOICEOVER_ENABLED ? <Audio src={staticFile('voiceover.mp3')} /> : null}
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Tutorial"
    component={Tutorial}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
