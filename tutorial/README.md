# Client tutorial video — Linear automation

A [Remotion](https://www.remotion.dev/) project that renders the client-facing
tutorial for the SyncView Linear submission form: how to organize footage in
Google Drive, fill in the form, and hit Create Linears.

Everything is code — the form is recreated from `index.html`'s styles, so if
the site changes, edit the scene and re-render.

## Commands

```bash
cd tutorial
npm install
npm run studio   # live preview / editing at localhost:3000
npm run render   # renders out/tutorial.mp4 (1920x1080, 30fps, ~1:45)
```

## Structure

- `src/timeline.ts` — scene durations + form walkthrough phase offsets. Edit here to retime.
- `src/scenes/Intro.tsx` — title card
- `src/scenes/DriveOrg.tsx` — animated "organize your Drive" infographic
- `src/scenes/FormDemo.tsx` — animated walkthrough of the Create Linear Issue form
- `src/scenes/Outro.tsx` — recap checklist
- `src/form.tsx` — UI components recreating the live form
- `src/ui.tsx` — cursor, browser chrome, captions, icons
- `VOICEOVER.md` — narration script + how to add the ElevenLabs voice track

## Notes

- The Plus Jakarta Sans font is self-hosted in `public/fonts/` (the render
  container can't reach Google Fonts; self-hosting also makes renders
  reproducible).
- Voiceover is off by default (`VOICEOVER_ENABLED` in `src/Root.tsx`).
  See `VOICEOVER.md`.
- Remotion is free for individuals and teams of up to 3 people; larger
  companies need a paid license (remotion.pro).
