#!/bin/sh
# Lays a route's slices side by side so a long page reads in one look.
#   sheet.sh <dir> <route-name> [per-sheet]
# Writes <dir>/_<route-name>-sheetN.png and prints the paths.
dir="$1"
name="$2"
per="${3:-3}"

files=""
if [ -f "$dir/$name.png" ]; then
  files="$dir/$name.png"
else
  i=1
  while [ -f "$dir/$name-$i.png" ]; do
    files="$files $dir/$name-$i.png"
    i=$((i + 1))
  done
fi

set -- $files
sheet=1
while [ $# -gt 0 ]; do
  batch=""
  n=0
  while [ $# -gt 0 ] && [ $n -lt "$per" ]; do
    batch="$batch $1"
    shift
    n=$((n + 1))
  done
  out="$dir/_$name-sheet$sheet.png"
  montage $batch -tile "${n}x1" -geometry +6+0 -gravity north -background '#3a3a3a' "$out"
  echo "$out"
  sheet=$((sheet + 1))
done
