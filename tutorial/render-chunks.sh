#!/bin/bash
# Chunked, resumable render. The headless browser in some containers freezes
# intermittently mid-render, killing long single-pass renders. Rendering in
# 450-frame chunks with retries makes a hang cost ~60s instead of the whole
# render. Re-running the script skips chunks that already finished.
set -u
cd "$(dirname "$0")"
mkdir -p out/chunks

# Keep in sync with TOTAL_FRAMES in src/timeline.ts
TOTAL=3150
STEP=450

for ((start = 0; start < TOTAL; start += STEP)); do
  end=$((start + STEP - 1))
  ((end >= TOTAL)) && end=$((TOTAL - 1))
  f="out/chunks/chunk-$(printf %04d "$start").mp4"
  if [ -f "$f.done" ]; then
    echo "skip $f"
    continue
  fi
  ok=""
  for attempt in 1 2 3; do
    if npx remotion render src/index.ts Tutorial "$f" \
      --frames="$start-$end" --concurrency=1 --timeout=60000 \
      >/tmp/chunk.log 2>&1; then
      touch "$f.done"
      echo "ok $f"
      ok=1
      break
    fi
    echo "retry $f (attempt $attempt)"
    tail -2 /tmp/chunk.log
  done
  if [ -z "$ok" ]; then
    echo "FAILED $f after 3 attempts"
    exit 1
  fi
done

ls out/chunks/chunk-*.mp4 | sort | sed "s/^/file '/; s/$/'/" >out/chunks/list.txt
npx remotion ffmpeg -y -f concat -safe 0 -i out/chunks/list.txt -c copy out/tutorial.mp4 >/tmp/concat.log 2>&1
echo "DONE: out/tutorial.mp4"
