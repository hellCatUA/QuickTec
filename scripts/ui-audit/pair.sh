#!/bin/sh
# Two screenshots side by side under "Before" and "After".
#   pair.sh <before.png> <after.png> <out.png> [height]
# Both are cut to the same height from the top (default 844) so they line up.
before="$1"; after="$2"; out="$3"; height="${4:-844}"
tmp="$(mktemp -d)"
# Inter where it is installed, ImageMagick's default font where it is not.
FONT="${FONT:-/usr/share/fonts/opentype/inter/Inter-SemiBold.otf}"
FONT_ARG=""
[ -f "$FONT" ] && FONT_ARG="-font $FONT"
for side in before after; do
  eval src=\$$side
  w=$(identify -format '%w' "$src")
  convert "$src" -crop "${w}x${height}+0+0" +repage "$tmp/$side.png"
done
label() {
  convert -background '#20242c' -fill "$2" $FONT_ARG \
    -pointsize 22 -size "$(identify -format '%w' "$tmp/$1.png")x44" -gravity center "caption:$3" "$tmp/$1-label.png"
  convert "$tmp/$1-label.png" "$tmp/$1.png" -append "$tmp/$1-full.png"
}
label before '#f0a64a' 'Before'
label after '#4fc98a' 'After'
convert "$tmp/before-full.png" "$tmp/after-full.png" -background '#20242c' -gravity north +smush 18 \
  -bordercolor '#20242c' -border 14 "$out"
rm -rf "$tmp"
echo "$out $(identify -format '%wx%h' "$out")"
