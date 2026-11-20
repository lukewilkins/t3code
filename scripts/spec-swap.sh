#!/bin/zsh
# Fork-only: swap a built "T3 Code (Spec).app" into /Applications and restart the Spec service.
# Run it detached (see CLAUDE.md), never from inside the service it restarts. Usage: spec-swap.sh <built .app>
set -u
R=${SPEC_SWAP_REPORT:-$HOME/.t3-spec/userdata/logs/spec-swap.md}
NEW="${1:?usage: spec-swap.sh <built .app>}"
mkdir -p "${R:h}"
APP="/Applications/T3 Code (Spec).app"
LABEL=com.markhuot.t3code.spec.service
DOMAIN=gui/$(id -u)
log() { echo "- $(date +%H:%M:%S) $*" | tee -a "$R"; }
# Never leave the service down: on failure, bring it back from whichever app is in place.
fail() {
  log "FAILED: $*"
  if ! launchctl print $DOMAIN/$LABEL >/dev/null 2>&1 && [ -d "$APP" ]; then
    launchctl bootstrap $DOMAIN "$HOME/Library/LaunchAgents/$LABEL.plist" 2>>"$R" \
      && log "Service bootstrapped again after the failure"
  fi
  exit 1
}
running() { [ -n "$(lsappinfo find bundleid=com.markhuot.t3code.spec)" ]; }

[ -d "$NEW" ] || fail "built app not found at $NEW"
log "New build: $NEW ($(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$NEW/Contents/Info.plist"))"

osascript -e 'quit app id "com.markhuot.t3code.spec"' >/dev/null 2>&1
for i in {1..120}; do running || break; sleep 1; done
running && fail "desktop app did not quit within 120s; nothing swapped"
log "Desktop app quit"

launchctl bootout $DOMAIN/$LABEL >/dev/null 2>&1
for i in {1..90}; do
  launchctl print $DOMAIN/$LABEL >/dev/null 2>&1 || lsof -nP -iTCP:3774 -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done
launchctl print $DOMAIN/$LABEL >/dev/null 2>&1 && fail "service still loaded 90s after bootout"
lsof -nP -iTCP:3774 -sTCP:LISTEN >/dev/null 2>&1 && fail "port 3774 still held after bootout"
log "Service unloaded; port 3774 free"

STAGE="/Applications/.T3 Code (Spec).app.new"
rm -rf "$STAGE"
ditto "$NEW" "$STAGE" || { rm -rf "$STAGE"; fail "ditto to staging failed"; }
xattr -cr "$STAGE"
trash "$APP" || { rm -rf "$STAGE"; fail "could not trash the old app"; }
mv "$STAGE" "$APP" || fail "could not move the new app into place"
codesign --verify --deep --strict "$APP" 2>>"$R" && log "codesign verify ok" || log "WARNING: codesign verify failed"
log "Installed $APP"

ok=""
for i in {1..30}; do
  if launchctl bootstrap $DOMAIN "$HOME/Library/LaunchAgents/$LABEL.plist" 2>>"$R"; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || fail "launchctl bootstrap kept failing for 60s"
log "Service bootstrapped (attempt $i)"

env=""
for i in {1..180}; do
  env=$(curl -fsS http://127.0.0.1:3774/.well-known/t3/environment 2>/dev/null) && break
  sleep 1
done
[ -n "$env" ] || fail "service did not answer on 3774 within 180s; see ~/.t3-spec/userdata/logs/boot-service.log"
log "Service up: ${env[1,300]}"
log "Listening: $(lsof -nP -iTCP:3774 -sTCP:LISTEN | tail -n +2 | awk '{print $1, $2, $9}')"

open -b com.markhuot.t3code.spec
log "Desktop app reopened"
log "SWAP DONE"
