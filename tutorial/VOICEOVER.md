# Voiceover script — Client tutorial video

## Recommended workflow (Eleven v3, one take)

Eleven v3 cannot hit precise timestamps (no `<break time>` support — only
`[short pause]` / `[long pause]` tags and punctuation), so don't try to match
the video's timing when recording. Instead:

1. Paste the tagged script below into ElevenLabs as ONE generation with your
   cloned voice (v3 keeps pacing more natural in a single take).
2. Hand the MP3 back — the video gets retimed to the narration (the line
   starts are detected with silence detection and the scene durations in
   `src/timeline.ts` are stretched to match), then re-rendered.

```
[warmly] Hey! Here's how to send us your footage and get your videos into production — it takes less than two minutes. [long pause]
Before you upload, organize your Google Drive like this. [short pause]
Make one folder for each script you film. [long pause]
Inside it, three folders: Main Camera, Side Camera, and Audio… one clip in each. [long pause]
Didn't record a side cam, or separate audio? Just leave that folder out. [long pause]
And keep the folder names EXACTLY like this, so our editors find everything instantly. [long pause]
Then, open your SyncView submission link. [short pause]
Start typing your name in Client, and pick it from the list. [short pause] The title fills in by itself. [long pause]
Filming Plans is handled automatically — you can skip right past it. [long pause]
Paste the link to your main Drive folder into General Drive. [long pause]
Now, for each video: paste the Main camera, Side camera, and Audio links from its script folder. [long pause]
Quick tip — hold Shift and click, to re-paste the last link you copied. [long pause]
Filmed more than one script? Click Add Video, and repeat. [long pause]
When everything is in… hit Create Linears. [long pause]
[cheerfully] And that's it! Your videos are in our production queue. [long pause]
So: organize your Drive, pick your name, paste your links, and hit Create Linears. We take it from there. [short pause] Questions? Just message us — happy to help.
```

## Manual alternative (sync audio to the current video)

Generate this with your ElevenLabs cloned voice, then:

1. Export the narration as a single MP3 timed to the cues below (easiest:
   generate each line separately, lay them on a timeline at the timestamps,
   export as one file).
2. Save it as `tutorial/public/voiceover.mp3`.
3. In `tutorial/src/Root.tsx`, set `VOICEOVER_ENABLED = true`.
4. Re-render: `npm run render`.

The on-screen captions show the same text at the same times, so the voice
will line up with what's happening on screen. Total video length: **1:45**.

| Start | End  | Line |
|-------|------|------|
| 0:01  | 0:05 | Hey! Here's how to send us your footage and get your videos into production — it takes less than two minutes. |
| 0:06  | 0:11 | Before you upload, organize your Google Drive like this. |
| 0:12  | 0:17 | Make one folder for each script you film. |
| 0:18  | 0:23 | Inside it, three folders: Main Camera, Side Camera, and Audio — one clip in each. |
| 0:24  | 0:28 | Didn't record a side cam or separate audio? Just leave that folder out. |
| 0:29  | 0:35 | And keep the folder names exactly like this, so our editors find everything instantly. |
| 0:36  | 0:39 | Then open your SyncView submission link. |
| 0:40  | 0:51 | Start typing your name in Client, and pick it from the list. The title fills in by itself. |
| 0:52  | 0:56 | Filming Plans is handled automatically — you can skip right past it. |
| 0:57  | 1:04 | Paste the link to your main Drive folder into General Drive. |
| 1:05  | 1:12 | Now, for each video: paste the Main camera, Side camera, and Audio links from its script folder. |
| 1:13  | 1:21 | Tip — hold Shift and click to re-paste the last link you copied. |
| 1:22  | 1:26 | Filmed more than one script? Click Add Video and repeat. |
| 1:27  | 1:31 | When everything is in, hit Create Linears. |
| 1:32  | 1:35 | And that's it — your videos are in our production queue. |
| 1:36  | 1:44 | So: organize your Drive, pick your name, paste your links, and hit Create Linears. We take it from there. Questions? Just message us. |

## Retiming

Scene lengths live in `src/timeline.ts` (frames, 30 fps) and the caption
cues sit at the top of each scene file (`CAPTIONS` arrays). If a narration
line runs long, stretch the matching scene duration and the captions move
with it.
