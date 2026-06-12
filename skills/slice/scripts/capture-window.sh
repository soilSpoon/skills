#!/bin/sh
# capture-window.sh <AppProcessName> <out.png>
# Captures the app's frontmost window WITHOUT stealing focus or requiring the
# window to be visible on top (screencapture -l works on occluded windows).
# Needs Screen Recording permission. Never uses AX queries (an `entire contents`
# query can wedge a SwiftUI app's accessibility server for minutes).
APP="$1"; OUT="$2"
[ -n "$APP" ] && [ -n "$OUT" ] || { echo "usage: capture-window.sh <AppName> <out.png>"; exit 2; }
ID=$(swift - <<EOF
import CoreGraphics
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in info where (w[kCGWindowOwnerName as String] as? String) == "$APP" && (w[kCGWindowLayer as String] as? Int) == 0 {
    print(w[kCGWindowNumber as String] as! Int)
    break
}
EOF
)
[ -n "$ID" ] || { echo "no on-screen window for '$APP'"; exit 1; }
screencapture -x -l "$ID" "$OUT" && echo "captured window $ID of $APP -> $OUT"
