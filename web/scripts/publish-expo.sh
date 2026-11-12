#!/bin/zsh
# Publish Juno to Expo (EAS Update) so it opens in Expo Go, then put the real link and QR on the landing page.
# Run it after `npx expo login` (Nick signs in himself; this script never asks for or stores credentials):
#   web/scripts/publish-expo.sh ["message"]
# Steps: check the login -> set app.json "owner" to that account -> `eas init` (creates the Expo project and writes
# extra.eas.projectId) -> `eas update` on the production branch -> write the update's Expo Go URL into
# web/public/download/manifest.json -> redeploy juno-avax (set NO_DEPLOY=1 to skip).
set -euo pipefail
export LANG=en_US.UTF-8
WEB=${0:A:h:h}
MSG=${1:-"Juno $(node -p "require('$WEB/app.json').expo.version") on Avalanche Fuji"}
EAS=(npx --yes eas-cli@latest)
cd "$WEB"

WHO=$(npx expo whoami 2>/dev/null || true)
if [[ -z "$WHO" || "$WHO" == *"Not logged in"* ]]; then
  echo "Setup required: run 'npx expo login' in $WEB first, then run this again."; exit 1
fi
echo "Expo account: $WHO"

node -e "
const fs = require('fs'); const p = 'app.json'; const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.expo.owner = process.argv[1];
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');" "$WHO"

# Link (or create) the Expo project; writes extra.eas.projectId into app.json.
"${EAS[@]}" init --non-interactive --force
PROJECT=$(node -p "require('./app.json').expo.extra?.eas?.projectId ?? ''")
[[ -n "$PROJECT" ]] || { echo "eas init did not write a projectId"; exit 1; }
node -e "
const fs = require('fs'); const p = 'app.json'; const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.expo.updates = { ...(j.expo.updates ?? {}), url: 'https://u.expo.dev/' + process.argv[1] };
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');" "$PROJECT"

# eas update needs expo-updates in the project (the standalone simulator build does not).
[[ -d node_modules/expo-updates ]] || npx expo install expo-updates

# The phone bundle never carries the QA signer; seeded art resolves from the hosted app.
export EXPO_PUBLIC_QA_SIGNER=0 EXPO_PUBLIC_APP_URL=https://juno-avax.vercel.app
OUT=$(mktemp)
"${EAS[@]}" update --branch production --message "$MSG" --platform all --non-interactive --json > "$OUT"
URL=$(node -e "
const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
const u = (Array.isArray(r) ? r : [r]).find(x => x.group) ?? {};
if (!u.group) { console.error('no update group in eas output'); process.exit(1); }
console.log('exp://u.expo.dev/' + process.argv[2] + '/group/' + u.group);" "$OUT" "$PROJECT")
rm -f "$OUT"
echo "Expo Go link: $URL"

node -e "
const fs = require('fs'); const p = process.argv[1];
const m = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
m.expo = { url: process.argv[2], project: process.argv[3], branch: 'production', published: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');" "$WEB/public/download/manifest.json" "$URL" "$PROJECT"

if [[ "${NO_DEPLOY:-}" != 1 ]]; then "$WEB/scripts/deploy-web.sh"; fi
echo "Done. Open $URL in Expo Go (or scan the QR on https://juno-avax.vercel.app/#get-app)."
