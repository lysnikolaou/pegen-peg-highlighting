import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'out/test/**/*.test.js',
    // CI runs both the oldest version in `engines` and the latest release.
    version: process.env.VSCODE_VERSION ?? 'stable',
    workspaceFolder: 'test/fixtures',
    launchArgs: ['--disable-extensions'],
    mocha: {
        ui: 'tdd',
        timeout: 20000,
    },
});
