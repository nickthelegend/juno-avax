#!/bin/zsh
# Export the Juno web build and deploy it to the juno-avax Vercel project (production).
#   web/scripts/deploy-web.sh
# The export serves /download (the iOS Simulator build and its SHA-256) from web/public/download.
# `expo export --clear` wipes dist, so the Vercel project link is written back after each export.
# The ids below are project ids, not secrets.
set -euo pipefail
WEB=${0:A:h:h}
[[ -f "$WEB/public/download/Juno-iOS-Simulator.zip" ]] || { echo "Missing web/public/download/Juno-iOS-Simulator.zip: run web/scripts/build-ios-sim.sh first"; exit 1; }
cd "$WEB"
EXPO_PUBLIC_APP_URL=https://juno-avax.vercel.app pnpm export:web
mkdir -p dist/.vercel
printf '{"projectId":"%s","orgId":"%s","projectName":"%s"}' prj_zdzQyJXjO3WRBFoQkAM4h4A2J0O5 team_gwapD8j8P5T3NxIU746NjNxe juno-avax > dist/.vercel/project.json
(cd dist && vercel deploy --prod --yes)
