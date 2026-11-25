#!/bin/sh
# Build the browser harness: the real lock-screen code with a stub for Obsidian's setIcon, so it can be
# rendered in a plain browser at any viewport size. Usage (from the repo root):
#   tools/harness/build.sh && (cd tools/harness && python3 -m http.server 8765)
#   open http://127.0.0.1:8765/frame.html?w=390&h=760&lang=ko&vl=retro&todos=1
# Query parameters are read in entry.ts (lang, vl=default|retro|cartoon, anim, image, video, todos, ...).
# Put your own img-<name>.jpg / <name>.mp4 next to index.html to test photo and video backgrounds.
set -e
cd "$(dirname "$0")/../.."
npx esbuild tools/harness/entry.ts --bundle --format=iife --outfile=tools/harness/bundle.js \
  --alias:obsidian=./tools/harness/obsidian-stub.ts --log-level=error
cp styles.css tools/harness/styles.css
echo "built tools/harness/bundle.js"
