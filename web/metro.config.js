const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro for a pnpm workspace. Expo detects the monorepo and watches the
 * workspace root, so `@juno/sdk` (TypeScript source in sdk/) is bundled
 * straight from the workspace.
 *
 * The QA signer is swapped in for the browser wallet only when the build is
 * made with EXPO_PUBLIC_QA_SIGNER=1; a production build refuses to import it.
 */
const path = require("node:path");
const config = getDefaultConfig(__dirname);
const qa = process.env.EXPO_PUBLIC_QA_SIGNER === "1";
config.cacheVersion = `${config.cacheVersion ?? "1"}-juno-wallet-${qa ? "qa" : "production"}`;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (!qa && /qa-signer/.test(moduleName)) throw new Error("QA signer imports are forbidden in a production build");
  if (qa && platform === "web" && moduleName === "./browser-wallet" && context.originModulePath.endsWith(path.join("lib", "wallet.tsx"))) {
    return { type: "sourceFile", filePath: path.join(__dirname, "lib", "qa-signer.web.ts") };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
