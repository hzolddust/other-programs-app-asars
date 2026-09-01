/**
 * NexoGameST Entry Bootstrapper
 * Clean JavaScript Launcher (ESM / CommonJS Dual Support)
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

app.name = 'NexoGameST';
app.setName('NexoGameST');
if (process.platform === 'win32') {
  app.setAppUserModelId('NexoGameST');
}

const cjsPath = path.join(__dirname, 'dist-electron', 'main.cjs');
const jsPath = path.join(__dirname, 'dist-electron', 'main.js');

try {
  if (fs.existsSync(cjsPath)) {
    require(cjsPath);
  } else if (fs.existsSync(jsPath)) {
    try {
      require(jsPath);
    } catch (err) {
      if (err.code === 'ERR_REQUIRE_ESM') {
        import(pathToFileURL(jsPath).href);
      } else {
        throw err;
      }
    }
  } else {
    console.error('[NexoGameST Bootstrapper] Critical Error: Neither main.cjs nor main.js found!');
  }
} catch (error) {
  console.error('[NexoGameST Bootstrapper] Runtime Error:', error);
  throw error;
}
