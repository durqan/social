const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const sharedRoot = path.resolve(__dirname, '../packages/shared');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [sharedRoot],
  resolver: {
    extraNodeModules: {
      '@social/shared': sharedRoot,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
