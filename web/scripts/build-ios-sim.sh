#!/bin/zsh
# Standalone Juno for the iOS Simulator (not Expo Go): its own icon, splash and embedded JS bundle.
#   web/scripts/build-ios-sim.sh   -> web/public/download/Juno-iOS-Simulator.zip (+ .sha256, manifest.json)
# Release build for Apple-silicon simulators (arm64), ad-hoc signed ("-") so the keychain works for the
# Juno wallet (expo-secure-store needs an entitlement that an unsigned app does not have).
# On this Mac only one Xcode build runs at a time: it takes grokbot/orchestration/.xcode-lock and frees it after.
# KEEP_BUILD=1 keeps ios/build (the .app) for installing; otherwise it is deleted to save disk.
set -euo pipefail
export LANG=en_US.UTF-8
WEB=${0:A:h:h}
REPO=${WEB:h}
LOCK="$REPO/../../orchestration/.xcode-lock"
OUT="$WEB/public/download"
BUNDLE_ID=app.launch.junoavax

if [[ "${JUNO_HAVE_LOCK:-}" != 1 ]]; then
  until mkdir "$LOCK" 2>/dev/null; do echo "waiting for the Xcode lock ($(cat "$LOCK/owner" 2>/dev/null))"; sleep 30; done
  echo "juno-avax $(date -u +%FT%TZ)" > "$LOCK/owner"
  trap 'rm -rf "$LOCK"' EXIT
fi

cd "$WEB"
# The phone build never carries the QA signer.
export EXPO_PUBLIC_QA_SIGNER=0
[[ -d ios ]] || npx expo prebuild --platform ios --no-install
(cd ios && pod install)
(cd ios && xcodebuild -workspace Juno.xcworkspace -scheme Juno -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= | tail -3)

APP="$WEB/ios/build/Build/Products/Release-iphonesimulator/Juno.app"
[[ -f "$APP/main.jsbundle" ]] || { echo "Juno.app has no embedded JS bundle"; exit 1; }
mkdir -p "$OUT"
rm -f "$OUT/Juno-iOS-Simulator.zip"
(cd "${APP:h}" && ditto -c -k --norsrc --keepParent Juno.app "$OUT/Juno-iOS-Simulator.zip")
SHA=$(shasum -a 256 "$OUT/Juno-iOS-Simulator.zip" | cut -d' ' -f1)
BYTES=$(stat -f %z "$OUT/Juno-iOS-Simulator.zip")
VERSION=$(node -p "require('$WEB/app.json').expo.version")
echo "$SHA  Juno-iOS-Simulator.zip" > "$OUT/Juno-iOS-Simulator.zip.sha256"
node -e "
const fs = require('fs'); const p = '$OUT/manifest.json';
const m = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { expo: { url: null } };
m.ios = { file: 'Juno-iOS-Simulator.zip', bytes: $BYTES, sha256: '$SHA', version: '$VERSION', built: new Date().toISOString().slice(0, 10),
  bundleId: '$BUNDLE_ID', build: 'Release, iphonesimulator arm64 (Apple silicon Macs), ad-hoc signed' };
fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');"
echo "Juno-iOS-Simulator.zip $BYTES bytes, sha256 $SHA"
echo "Install: unzip it, then: xcrun simctl install booted Juno.app && xcrun simctl launch booted $BUNDLE_ID"
[[ "${KEEP_BUILD:-}" == 1 ]] || rm -rf "$WEB/ios/build"
