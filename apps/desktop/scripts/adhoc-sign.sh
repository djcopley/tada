#!/usr/bin/env bash
# Ad-hoc signs the packaged app with its real bundle identifier.
#
# This is NOT about Gatekeeper — an ad-hoc signature does nothing for distribution, and the build
# is still unsigned in the sense that matters there. It is about notifications, which are the
# reason the desktop app exists.
#
# macOS keys notification authorization to an app's *code signature identity*. electron-builder
# with `identity: null` skips signing altogether, which leaves the binary carrying Electron's own
# linker-signed identity (`codesign -dv` reports `Identifier=Electron`) even though Info.plist
# says dev.tada.desktop. In that state macOS never registers the app as a notification client:
# every Notification.show() fails silently with `UNErrorDomain error 1` (notificationsNotAllowed),
# no permission prompt is ever shown, and the app never appears in System Settings →
# Notifications. Re-signing ad-hoc with the correct identifier is what makes macOS treat it as a
# real app and prompt for permission.
#
# `--deep` is deprecated by Apple for distribution signing, but it is the documented way to
# re-sign a bundle's nested helpers in place for local use, and this build never leaves the
# machine that made it. If a future macOS drops it, sign the helpers innermost-first instead.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
app="$here/../release/mac-arm64/tada.app"
identifier="dev.tada.desktop"

if [ ! -d "$app" ]; then
  echo "adhoc-sign: no app bundle at $app (run the packaging step first)" >&2
  exit 1
fi

codesign --force --deep --sign - --identifier "$identifier" "$app"

# Prove the identity actually took: a silent mismatch here is exactly the failure this script
# exists to prevent, and it is invisible until a notification does not arrive.
actual=$(codesign -dv "$app" 2>&1 | awk -F= '/^Identifier=/ { print $2 }')
if [ "$actual" != "$identifier" ]; then
  echo "adhoc-sign: expected Identifier=$identifier but got '$actual'" >&2
  exit 1
fi
echo "adhoc-sign: $app signed ad-hoc as $identifier"
