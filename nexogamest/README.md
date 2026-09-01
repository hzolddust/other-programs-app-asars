# NexoGameST (v2.0.0) - Orijinal & Temiz Kaynak Kodları

Bu klasör, NexoGameST uygulamasının şifrelemesi ve bytecode (bytenode) kilitleri tamamen kaldırılarak çözülmüş, temiz ve çalışır durumdaki kaynak kodlarını içerir.

## 📂 Dosya Yapısı

- `entry.cjs` - Temiz Electron başlatıcı bootstrapper (şifresiz `dist-electron/main.js` çağırır)
- `package.json` - Proje bağımlılıkları ve konfigürasyonu
- `dist-electron/`
  - `main.js` - Ana Electron süreci (Pencere yönetimi, IPC iletişimleri, Discord RPC, Dosya İndirme Yöneticisi, Steam entegrasyonu)
  - `preload.cjs` - CommonJS Preload köprüsü (`window.electronAPI`)
  - `preload.js` - ES Module Preload köprüsü
- `dist/`
  - `index.html` - NexoGameST v2 arayüz başlangıç sayfası
  - `icon.ico`, `icon.png`, `logo.png` - Uygulama simgeleri
  - `assets/` - React frontend derleme dosyaları (`index-BsMb7DfG.js`, `index-DzF95l2N.css`, `state-B3T2PPlo.js`, vb.)

## 🚀 Çalıştırma

```bash
npm start
```
veya
```bash
npx electron .
```
