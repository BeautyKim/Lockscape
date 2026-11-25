#!/bin/sh
# Make a clip loop seamlessly: the last D seconds crossfade into the start. Usage: make-loop.sh in.mp4 out.mp4 [crossfade_seconds=1]
set -e
IN="$1"; OUT="$2"; D="${3:-1}"
LEN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
BODY=$(python3 -c "print(round($LEN-$D,3))")
ffmpeg -y -loglevel error -i "$IN" -filter_complex \
 "[0:v]split=2[h0][t0];[h0]trim=0:$BODY,setpts=PTS-STARTPTS[head];[t0]trim=$BODY:$LEN,setpts=PTS-STARTPTS[tail];[tail][head]xfade=transition=fade:duration=$D:offset=0[v]" \
 -map "[v]" -an -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -movflags +faststart "$OUT"
