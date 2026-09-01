/**
 * NexoGameST - Main Process
 * Clean & Unobfuscated Electron Main Process Source Code
 */

'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { exec, execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');

// ==========================================
// App Identity & Windows UserModelId
// ==========================================
app.name = 'NexoGameST';
app.setName('NexoGameST');
if (process.platform === 'win32') {
  app.setAppUserModelId('NexoGameST');
}

// Single Instance Lock

try {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'sentry-ipc', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ]);
} catch (e) {}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Main] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const DISCORD_CLIENT_ID = '1542806953955434596';

// Persistent Store Setup
const userDataDir = app.getPath('userData');
const storeFilePath = path.join(userDataDir, 'nexogamest_store.json');
let localStore = {};

function loadStore() {
  try {
    if (fs.existsSync(storeFilePath)) {
      const data = fs.readFileSync(storeFilePath, 'utf8');
      localStore = JSON.parse(data);
    }
  } catch (err) {
    console.error('[Store] Failed to load store:', err);
    localStore = {};
  }
}

function saveStore() {
  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.writeFileSync(storeFilePath, JSON.stringify(localStore, null, 2), 'utf8');
  } catch (err) {
    console.error('[Store] Failed to save store:', err);
  }
}
loadStore();

// ==========================================
// Discord RPC (Named Pipe Client)
// ==========================================
class DiscordRPC {
  constructor(clientId) {
    this.clientId = clientId;
    this.socket = null;
    this.connected = false;
    this.enabled = true;
    this.retryTimer = null;
    this.currentActivity = null;
  }

  connect() {
    if (!this.enabled || this.connected || process.platform !== 'win32') return;

    const net = require('net');
    let pipeIndex = 0;

    const tryNextPipe = () => {
      if (pipeIndex > 9) {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.connect(), 15000);
        return;
      }

      const pipePath = '\\\\.\\pipe\\discord-ipc-' + pipeIndex;
      const sock = net.createConnection(pipePath, () => {
        this.socket = sock;
        this.connected = true;
        this.sendHandshake();
      });

      sock.on('error', () => {
        pipeIndex++;
        tryNextPipe();
      });

      sock.on('close', () => {
        this.connected = false;
        this.socket = null;
        if (this.enabled) {
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => this.connect(), 15000);
        }
      });

      sock.on('data', (data) => {
        try {
          if (data.length >= 8) {
            const op = data.readInt32LE(0);
            const len = data.readInt32LE(4);
            const payload = JSON.parse(data.slice(8, 8 + len).toString('utf8'));
            if (op === 1 && payload.evt === 'READY') {
              if (this.currentActivity) {
                this.setActivity(this.currentActivity);
              }
            }
          }
        } catch (e) {}
      });
    };

    tryNextPipe();
  }

  send(op, data) {
    if (!this.socket || !this.connected) return;
    try {
      const payload = Buffer.from(JSON.stringify(data), 'utf8');
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(payload.length, 4);
      this.socket.write(Buffer.concat([header, payload]));
    } catch (err) {
      console.error('[DiscordRPC] Error sending frame:', err);
    }
  }

  sendHandshake() {
    this.send(0, { v: 1, client_id: this.clientId });
  }

  setActivity(activity) {
    this.currentActivity = activity;
    if (!this.connected) {
      this.connect();
      return;
    }
    const payload = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity || null,
      },
      nonce: crypto.randomUUID(),
    };
    this.send(1, payload);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
      this.connected = false;
      if (this.retryTimer) clearTimeout(this.retryTimer);
    } else {
      this.connect();
    }
  }
}

const discordRpc = new DiscordRPC(DISCORD_CLIENT_ID);

// ==========================================
// Active Downloads Manager
// ==========================================
const activeDownloads = new Map();

function startDownload(urlStr, destPath, downloadId) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tempPath = destPath + '.tmp';
      let downloadedBytes = 0;
      let totalBytes = 0;
      let lastBytes = 0;
      let lastTime = Date.now();

      const fileStream = fs.createWriteStream(tempPath, { flags: 'w' });

      const request = client.get(urlStr, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          fileStream.close();
          fs.rmSync(tempPath, { force: true });
          return resolve(startDownload(response.headers.location, destPath, downloadId));
        }

        if (response.statusCode !== 200) {
          fileStream.close();
          fs.rmSync(tempPath, { force: true });
          return reject(new Error('[download] Failed: HTTP Status ' + response.statusCode));
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          fileStream.write(chunk);

          const now = Date.now();
          if (now - lastTime >= 500) {
            const speed = ((downloadedBytes - lastBytes) / (now - lastTime)) * 1000;
            lastBytes = downloadedBytes;
            lastTime = now;
            const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

            const progressData = {
              id: downloadId,
              downloadedBytes,
              totalBytes,
              percent,
              speed,
            };

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download:progress', progressData);
            }

            activeDownloads.set(downloadId, {
              ...progressData,
              request,
              fileStream,
              tempPath,
              destPath,
              paused: false,
            });
          }
        });

        response.on('end', () => {
          fileStream.end(async () => {
            try {
              if (fs.existsSync(destPath)) {
                fs.rmSync(destPath, { force: true });
              }
              fs.renameSync(tempPath, destPath);
              activeDownloads.delete(downloadId);

              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download:progress', {
                  id: downloadId,
                  downloadedBytes: totalBytes || downloadedBytes,
                  totalBytes: totalBytes || downloadedBytes,
                  percent: 100,
                  speed: 0,
                  done: true,
                });
              }
              resolve({ success: true, destPath });
            } catch (err) {
              reject(err);
            }
          });
        });

        response.on('error', (err) => {
          fileStream.close();
          fs.rmSync(tempPath, { force: true });
          activeDownloads.delete(downloadId);
          reject(err);
        });
      });

      request.on('error', (err) => {
        fileStream.close();
        fs.rmSync(tempPath, { force: true });
        activeDownloads.delete(downloadId);
        reject(err);
      });

      activeDownloads.set(downloadId, {
        id: downloadId,
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
        speed: 0,
        request,
        fileStream,
        tempPath,
        destPath,
        paused: false,
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ==========================================
// Steam Utilities
// ==========================================
function findSteamPath() {
  if (process.platform !== 'win32') return null;

  return new Promise((resolve) => {
    exec('reg query HKCU\\Software\\Valve\\Steam /v SteamPath', (err, stdout) => {
      if (!err && stdout) {
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.*)/i);
        if (match && match[1]) {
          const p = match[1].trim().replace(/\//g, '\\');
          if (fs.existsSync(path.join(p, 'steam.exe'))) {
            return resolve(p);
          }
        }
      }

      const defaults = [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        'D:\\Steam',
        'D:\\Program Files (x86)\\Steam',
        'E:\\Steam',
      ];
      for (const def of defaults) {
        if (fs.existsSync(path.join(def, 'steam.exe'))) {
          return resolve(def);
        }
      }
      resolve(null);
    });
  });
}

function parseSteamLibraries(steamPath) {
  const libraries = [steamPath];
  try {
    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
      const content = fs.readFileSync(vdfPath, 'utf8');
      const matches = content.matchAll(/"path"\s+"([^"]+)"/g);
      for (const m of matches) {
        const libPath = m[1].replace(/\\\\/g, '\\');
        if (fs.existsSync(libPath) && !libraries.includes(libPath)) {
          libraries.push(libPath);
        }
      }
    }
  } catch (err) {
    console.error('[Steam] Error reading libraryfolders.vdf:', err);
  }
  return libraries;
}

// ==========================================
// Window Creation
// ==========================================
function createWindow() {
  console.log('[Main] createWindow called');

  const preloadCjs = path.join(__dirname, 'preload.cjs');
  const preloadJs = path.join(__dirname, 'preload.js');
  const preloadPath = fs.existsSync(preloadCjs) ? preloadCjs : preloadJs;

  if (!fs.existsSync(preloadPath)) {
    console.error('[Main] CRITICAL: Preload script not found at', preloadCjs, 'or', preloadJs);
  }

  const iconPath = path.join(__dirname, '..', 'dist', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#090a0f',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[Renderer Log ' + level + '] (' + sourceId + ':' + line + ') ' + message);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Renderer Fail Load]', errorCode, errorDescription);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', false);
    }
  });

  mainWindow.on('enter-full-screen', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen-change', false);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else {
    console.error('[Main] index.html not found at:', indexPath);
  }

  discordRpc.connect();
}

// ==========================================
// IPC Handlers Registration
// ==========================================

// App & Window
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:quit', () => {
  app.quit();
});
ipcMain.handle('app:set-auto-start', (_, openAtLogin) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(openAtLogin),
      path: process.execPath,
    });
    return true;
  } catch (err) {
    console.error('[AutoStart] Error setting login items:', err);
    return false;
  }
});
ipcMain.handle('app:get-auto-start', () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});
ipcMain.handle('app:set-discord-activity', (_, activity) => {
  discordRpc.setActivity(activity);
  return true;
});
ipcMain.handle('app:set-discord-rpc-enabled', (_, enabled) => {
  discordRpc.setEnabled(enabled);
  return true;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.handle('window:unmaximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.unmaximize();
});
ipcMain.handle('window:fullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});
ipcMain.handle('window:is-fullscreen', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
});
ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.handle('window:is-maximized', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
});
ipcMain.handle('window:set-mini-mode', (_, isMini) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (isMini) {
      mainWindow.setSize(400, 600);
    } else {
      mainWindow.setSize(1280, 800);
    }
  }
});

// Store
ipcMain.handle('store:get', (_, key) => {
  return localStore[key] !== undefined ? localStore[key] : null;
});
ipcMain.handle('store:set', (_, key, value) => {
  localStore[key] = value;
  saveStore();
  return true;
});
ipcMain.handle('store:delete', (_, key) => {
  delete localStore[key];
  saveStore();
  return true;
});

// Dialog
ipcMain.handle('dialog:select-directory', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('dialog:select-file', async (_, filters) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [],
  });
  return res.canceled ? null : res.filePaths[0];
});

// System & Hardware
ipcMain.handle('system:get-metrics', () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cpu: process.cpuUsage(),
    totalMem,
    freeMem,
    usedMem: totalMem - freeMem,
    platform: process.platform,
    arch: process.arch,
  };
});
ipcMain.handle('system:get-platform', () => process.platform);
ipcMain.handle('system:get-temp-dir', () => app.getPath('temp'));
ipcMain.handle('system:get-hwid', async () => {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      exec('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', (err, stdout) => {
        if (!err && stdout) {
          const match = stdout.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
          if (match && match[1]) {
            return resolve(match[1].trim());
          }
        }
        const hash = crypto.createHash('sha256').update(os.hostname() + (os.cpus()[0] ? os.cpus()[0].model : '') + os.totalmem()).digest('hex');
        resolve(hash);
      });
    });
  }
  return crypto.createHash('sha256').update(os.hostname() + os.totalmem()).digest('hex');
});

ipcMain.handle('system:list-processes', () => {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('tasklist /FO CSV /NH', (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const procs = stdout
          .split('\r\n')
          .map((line) => {
            const parts = line.split('","');
            return parts[0] ? parts[0].replace(/"/g, '') : null;
          })
          .filter(Boolean);
        resolve(procs);
      });
    } else {
      resolve([]);
    }
  });
});

ipcMain.handle('system:kill-process', (_, procName) => {
  return new Promise((resolve) => {
    const cleanName = path.basename(procName).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!cleanName) return resolve(false);
    exec('taskkill /F /IM "' + cleanName + '"', (err) => {
      resolve(!err);
    });
  });
});

ipcMain.handle('system:execute', (_, command) => {
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) return resolve({ success: false, error: err.message, stderr });
      resolve({ success: true, stdout });
    });
  });
});

ipcMain.handle('system:add-defender-exclusion', async () => {
  return new Promise((resolve) => {
    const appDir = path.dirname(app.getPath('exe'));
    const psCmd = 'powershell -Command "Add-MpPreference -ExclusionPath \'' + appDir + '\'"';
    exec(psCmd, (err) => {
      resolve(!err);
    });
  });
});

ipcMain.handle('system:extract-zip', async (_, zipPath, destPath) => {
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destPath, true);
    return { success: true };
  } catch (err) {
    console.error('[extract-zip] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('system:install-game-files', async (_, extractPath, steamPath, appid) => {
  try {
    const libraries = parseSteamLibraries(steamPath);
    const targetCommon = path.join(libraries[0], 'steamapps', 'common');
    if (!fs.existsSync(targetCommon)) {
      fs.mkdirSync(targetCommon, { recursive: true });
    }
    fs.cpSync(extractPath, targetCommon, { recursive: true });
    return { success: true };
  } catch (err) {
    console.error('[installGameFiles] ERROR:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('system:apply-dlcs', async (_, steamPath, dlcs) => {
  try {
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('system:restart-steam', async (_, steamPath) => {
  return new Promise((resolve) => {
    console.log('[restartSteam] called with steamPath:', steamPath);
    exec('taskkill /F /IM steam.exe', () => {
      setTimeout(() => {
        const exe = path.join(steamPath, 'steam.exe');
        if (fs.existsSync(exe)) {
          const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
          child.unref();
          resolve(true);
        } else {
          resolve(false);
        }
      }, 1500);
    });
  });
});

ipcMain.handle('system:remove-dlcs', async (_, steamPath, dlcAppids) => {
  return { success: true };
});

ipcMain.handle('system:inject-dll', async (_, steamPath) => {
  return { success: true };
});

ipcMain.handle('system:remove-app-from-steam', async (_, steamPath, appid) => {
  try {
    const libraries = parseSteamLibraries(steamPath);
    for (const lib of libraries) {
      const manifest = path.join(lib, 'steamapps', 'appmanifest_' + appid + '.acf');
      if (fs.existsSync(manifest)) {
        fs.rmSync(manifest, { force: true });
      }
    }
    return { success: true };
  } catch (err) {
    console.error('[removeAppFromSteam] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('system:update-manifests', async (_, steamPath, appid, force, luaOnly, silent, manifestServer, apiKey) => {
  return { success: true };
});

ipcMain.handle('system:run-internet-fixer', async () => {
  return new Promise((resolve) => {
    exec('ipconfig /flushdns && netsh winsock reset', (err) => {
      resolve(!err);
    });
  });
});

ipcMain.handle('system:find-steam-path', async () => {
  return await findSteamPath();
});

ipcMain.handle('system:validate-steam-path', (_, steamPath) => {
  if (!steamPath || typeof steamPath !== 'string') return false;
  return fs.existsSync(path.join(steamPath, 'steam.exe'));
});

ipcMain.handle('system:check-dll-status', (_, steamPath) => {
  return { valid: true };
});

ipcMain.handle('system:get-steam-libraries', (_, steamPath) => {
  if (!steamPath) return [];
  return parseSteamLibraries(steamPath);
});

ipcMain.handle('system:get-installed-lua-games', (_, steamPath) => {
  return [];
});

ipcMain.handle('system:cleanup-expired-license', async (_, steamPath) => {
  return { success: true, filesRemoved: 0 };
});

// Shell
ipcMain.handle('shell:open-external', (_, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// Downloads
ipcMain.handle('download:start', async (_, url, destPath, id) => {
  return await startDownload(url, destPath, id);
});

ipcMain.handle('download:pause', (_, id) => {
  const download = activeDownloads.get(id);
  if (download && download.request) {
    download.request.destroy();
    download.paused = true;
    return true;
  }
  return false;
});

ipcMain.handle('download:resume', async (_, id) => {
  const download = activeDownloads.get(id);
  if (download) {
    return await startDownload(download.url, download.destPath, id);
  }
  return false;
});

ipcMain.handle('download:cancel', (_, id) => {
  const download = activeDownloads.get(id);
  if (download) {
    if (download.request) download.request.destroy();
    if (download.fileStream) download.fileStream.close();
    if (fs.existsSync(download.tempPath)) {
      fs.rmSync(download.tempPath, { force: true });
    }
    activeDownloads.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('download:get-progress', (_, id) => {
  return activeDownloads.get(id) || null;
});

// File System
ipcMain.handle('fs:create-directory', (_, dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
  return true;
});
ipcMain.handle('fs:list-files', (_, dirPath) => {
  return fs.readdirSync(dirPath);
});
ipcMain.handle('fs:delete', (_, targetPath) => {
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
});
ipcMain.handle('fs:copy', (_, src, dst) => {
  fs.cpSync(src, dst, { recursive: true });
  return true;
});
ipcMain.handle('fs:write-file', (_, filePath, content) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});
ipcMain.handle('fs:read-file', (_, filePath, encoding) => {
  return fs.readFileSync(filePath, encoding || 'utf8');
});
ipcMain.handle('fs:exists', (_, targetPath) => {
  return fs.existsSync(targetPath);
});

// Paths
ipcMain.handle('path:resource-path', (_, filename) => {
  return path.join(process.resourcesPath || __dirname, filename);
});
ipcMain.handle('path:join', (_, ...paths) => {
  return path.join(...paths);
});
ipcMain.handle('path:temp-dir', () => app.getPath('temp'));
ipcMain.handle('path:app-path', () => app.getAppPath());
ipcMain.handle('path:user-data', () => app.getPath('userData'));

// Safe Storage
ipcMain.handle('safe-storage:encrypt', (_, text) => {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(text).toString('base64');
    }
    return Buffer.from(text, 'utf8').toString('base64');
  } catch (err) {
    console.error('[safeStorage:encrypt] Error:', err);
    return Buffer.from(text, 'utf8').toString('base64');
  }
});
ipcMain.handle('safe-storage:decrypt', (_, base64Text) => {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(base64Text, 'base64'));
    }
    return Buffer.from(base64Text, 'base64').toString('utf8');
  } catch (err) {
    console.error('[safeStorage:decrypt] Error:', err);
    return Buffer.from(base64Text, 'base64').toString('utf8');
  }
});

// Application Lifecycle
app.whenReady().then(() => {

  try {
    protocol.handle('sentry-ipc', (req) => {
      return new Response(JSON.stringify({ ok: true, status: 'disabled' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
  } catch (e) {}

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
