/**
 * NexoGameST - Preload Script (CommonJS)
 * Clean & Unobfuscated Preload Bridge
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Preload script starting...');

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    quit: () => ipcRenderer.invoke('app:quit'),
    setAutoStart: (openAtLogin) => ipcRenderer.invoke('app:set-auto-start', openAtLogin),
    getAutoStart: () => ipcRenderer.invoke('app:get-auto-start'),
    setDiscordActivity: (activity) => ipcRenderer.invoke('app:set-discord-activity', activity),
    setDiscordRpcEnabled: (enabled) => ipcRenderer.invoke('app:set-discord-rpc-enabled', enabled),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
    fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
    isFullScreen: () => ipcRenderer.invoke('window:is-fullscreen'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    setMiniMode: (isMini) => ipcRenderer.invoke('window:set-mini-mode', isMini),
    onMaximizedChange: (callback) => {
      const handler = (_, isMax) => callback(isMax);
      ipcRenderer.on('window:maximized-change', handler);
      return () => {
        ipcRenderer.removeListener('window:maximized-change', handler);
      };
    },
    onFullScreenChange: (callback) => {
      const handler = (_, isFull) => callback(isFull);
      ipcRenderer.on('window:fullscreen-change', handler);
      return () => {
        ipcRenderer.removeListener('window:fullscreen-change', handler);
      };
    },
  },
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
    selectFile: (filters) => ipcRenderer.invoke('dialog:select-file', filters),
  },
  system: {
    getMetrics: () => ipcRenderer.invoke('system:get-metrics'),
    getPlatform: () => ipcRenderer.invoke('system:get-platform'),
    getTempDir: () => ipcRenderer.invoke('system:get-temp-dir'),
    getHWID: () => ipcRenderer.invoke('system:get-hwid'),
    listProcesses: () => ipcRenderer.invoke('system:list-processes'),
    killProcess: (name) => ipcRenderer.invoke('system:kill-process', name),
    execute: (command) => ipcRenderer.invoke('system:execute', command),
    addDefenderExclusion: () => ipcRenderer.invoke('system:add-defender-exclusion'),
    extractZip: (zipPath, destPath) => ipcRenderer.invoke('system:extract-zip', zipPath, destPath),
    installGameFiles: (extractPath, steamPath, appid) => ipcRenderer.invoke('system:install-game-files', extractPath, steamPath, appid),
    applyDLCs: (steamPath, dlcs) => ipcRenderer.invoke('system:apply-dlcs', steamPath, dlcs),
    restartSteam: (steamPath) => ipcRenderer.invoke('system:restart-steam', steamPath),
    removeDLCs: (steamPath, dlcAppids) => ipcRenderer.invoke('system:remove-dlcs', steamPath, dlcAppids),
    injectDLL: (steamPath) => ipcRenderer.invoke('system:inject-dll', steamPath),
    removeAppFromSteam: (steamPath, appid) => ipcRenderer.invoke('system:remove-app-from-steam', steamPath, appid),
    updateManifests: (steamPath, appid, force, luaOnly, silent, manifestServer, apiKey) => ipcRenderer.invoke('system:update-manifests', steamPath, appid, force, luaOnly, silent, manifestServer, apiKey),
    runInternetFixer: () => ipcRenderer.invoke('system:run-internet-fixer'),
    findSteamPath: () => ipcRenderer.invoke('system:find-steam-path'),
    validateSteamPath: (steamPath) => ipcRenderer.invoke('system:validate-steam-path', steamPath),
    checkDLLStatus: (steamPath) => ipcRenderer.invoke('system:check-dll-status', steamPath),
    getSteamLibraries: (steamPath) => ipcRenderer.invoke('system:get-steam-libraries', steamPath),
    getInstalledLuaGames: (steamPath) => ipcRenderer.invoke('system:get-installed-lua-games', steamPath),
    cleanupExpiredLicense: (steamPath) => ipcRenderer.invoke('system:cleanup-expired-license', steamPath),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  download: {
    start: (url, destPath, id) => ipcRenderer.invoke('download:start', url, destPath, id),
    pause: (id) => ipcRenderer.invoke('download:pause', id),
    resume: (id) => ipcRenderer.invoke('download:resume', id),
    cancel: (id) => ipcRenderer.invoke('download:cancel', id),
    getProgress: (id) => ipcRenderer.invoke('download:get-progress', id),
    onProgress: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('download:progress', handler);
      return () => ipcRenderer.removeListener('download:progress', handler);
    }
  },
  fs: {
    createDirectory: (path) => ipcRenderer.invoke('fs:create-directory', path),
    listFiles: (path) => ipcRenderer.invoke('fs:list-files', path),
    delete: (path) => ipcRenderer.invoke('fs:delete', path),
    copy: (src, dst) => ipcRenderer.invoke('fs:copy', src, dst),
    writeFile: (path, content) => ipcRenderer.invoke('fs:write-file', path, content),
    readFile: (path, encoding) => ipcRenderer.invoke('fs:read-file', path, encoding),
    exists: (path) => ipcRenderer.invoke('fs:exists', path),
  },
  path: {
    resourcePath: (filename) => ipcRenderer.invoke('path:resource-path', filename),
    join: (...paths) => ipcRenderer.invoke('path:join', ...paths),
    tempDir: () => ipcRenderer.invoke('path:temp-dir'),
    appPath: () => ipcRenderer.invoke('path:app-path'),
    userDataPath: () => ipcRenderer.invoke('path:user-data'),
  },
  safeStorage: {
    encrypt: (text) => ipcRenderer.invoke('safe-storage:encrypt', text),
    decrypt: (base64Text) => ipcRenderer.invoke('safe-storage:decrypt', base64Text),
  },
};

function deepFreeze(object) {
  Object.keys(object).forEach(prop => {
    if (object[prop] && typeof object[prop] === 'object' && !Object.isFrozen(object[prop])) {
      deepFreeze(object[prop]);
    }
  });
  return Object.freeze(object);
}

try {
  contextBridge.exposeInMainWorld('electronAPI', deepFreeze(api));
  console.log('[Preload] electronAPI exposed and frozen securely');
} catch (error) {
  console.error('[Preload] Failed to expose electronAPI:', error);
}

contextBridge.exposeInMainWorld('isElectron', true);
