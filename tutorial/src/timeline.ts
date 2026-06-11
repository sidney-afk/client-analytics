export const FPS = 30;

// Scene durations in frames. The voiceover script in VOICEOVER.md is generated
// from these numbers — keep them in sync if you retime anything.
export const SCENES = {
  intro: 170,
  driveOrg: 900,
  formDemo: 1800,
  outro: 280,
} as const;

export const TOTAL_FRAMES =
  SCENES.intro + SCENES.driveOrg + SCENES.formDemo + SCENES.outro;

// Frame offsets (relative to the start of formDemo) for each phase of the
// form walkthrough.
export const FORM = {
  appear: 0,
  client: 110,
  filming: 470,
  drive: 620,
  videos: 870,
  addVideo: 1390,
  submit: 1530,
  success: 1670,
} as const;

export const sceneStart = (name: keyof typeof SCENES): number => {
  const order: (keyof typeof SCENES)[] = ['intro', 'driveOrg', 'formDemo', 'outro'];
  let acc = 0;
  for (const s of order) {
    if (s === name) return acc;
    acc += SCENES[s];
  }
  return acc;
};

export const toTimestamp = (frame: number): string => {
  const totalSec = frame / FPS;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
