// Learn more https://docs.expo.dev/guides/monorepos/#metro-config
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Fix for lucide-react-native and other packages using .mjs ESM exports
// that fail to resolve on Windows with Metro's default config
config.resolver.sourceExts.push('mjs');
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
