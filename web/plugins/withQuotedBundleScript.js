/**
 * Quote the path in the "Bundle React Native code and images" build phase.
 *
 * The template runs the bundler script as a bare command substitution:
 *
 *     `"$NODE_BINARY" --print "…/react-native-xcode.sh"`
 *
 * The *result* of the backticks is run unquoted, so a project whose path
 * contains a space — this one lives under "/Volumes/Extreme SSD" — splits at
 * the space and the build fails with "/Volumes/Extreme: No such file or
 * directory". Wrapping it as "$(…)" runs the same script with its path intact.
 * `ios/` is generated, so the fix lives here and survives every prebuild.
 * Expo SDK 58's template already quotes the substitution ("`…`"); that form
 * is left as it is.
 */
const { withXcodeProject } = require("expo/config-plugins");

const BROKEN = '`\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\"`';
const FIXED = '\\"$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\")\\"';

module.exports = function withQuotedBundleScript(config) {
  return withXcodeProject(config, (mod) => {
    const phases = mod.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    for (const phase of Object.values(phases)) {
      if (typeof phase !== "object" || typeof phase.shellScript !== "string") continue;
      // SDK 58's template already wraps the backticks in double quotes, which
      // keeps the path whole; rewriting that form would unquote it again.
      if (phase.shellScript.includes(BROKEN) && !phase.shellScript.includes(`\\"${BROKEN}\\"`)) {
        phase.shellScript = phase.shellScript.replace(BROKEN, FIXED);
      }
    }
    return mod;
  });
};
