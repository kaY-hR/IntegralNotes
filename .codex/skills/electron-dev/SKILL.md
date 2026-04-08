---
name: electron-dev
description: Electronアプリ開発時の注意点とベストプラクティス。Windows環境での既知の問題回避策を含む。
---

# Electron開発ガイドライン

このスキルは、Electronアプリケーション開発時に自動的にロードされ、既知の問題を回避するためのガイドラインを提供します。

## 重要な注意点

### 1. Windows環境でのダイアログ問題（Electron issue #22923）

**問題:**
Windows + Electron で renderer 側の `alert()` / `confirm()` / `prompt()` を呼ぶと、入力欄がフォーカスできなくなる不具合があります。

**対策:**
- renderer側では `alert()` / `confirm()` / `prompt()` を**使用しない**
- 代わりに、以下のいずれかを使用：
  - カスタムモーダルダイアログ（HTML/CSS/JS）
  - IPC経由でmain processの `dialog` モジュールを呼び出す
  - サードパーティライブラリ（例：`electron-dialog`）

**コード例:**
```javascript
// ❌ 避ける
const result = confirm('本当に削除しますか？');

// ✅ 推奨：IPC経由でmain processのdialogを使用
const { ipcRenderer } = require('electron');
const result = await ipcRenderer.invoke('show-confirm-dialog', {
  message: '本当に削除しますか？'
});
```

### 2. Viteのバージョン制限

**問題:**
Vite v6 では Electron アプリの起動やビルドに失敗することがあります。

**対策:**
- **Vite v5 を使用する**
- `package.json` で明示的にバージョンを指定：
  ```json
  {
    "devDependencies": {
      "vite": "^5.0.0"
    }
  }
  ```

### 3. VSCodeによるapp.asarのロック問題

**問題:**
一度 `app.asar` をビルドすると、VSCodeがそのファイルを永久に握り続け、再ビルド時にエラーが発生します。

**対策:**
- プロジェクトの `.vscode/settings.json` に以下の設定を追加し、`app.asar` を監視対象から除外する：

```json
{
  "files.watcherExclude": {
    "**/dist/**": true,
    "**/out/**": true,
    "**/*.asar": true
  },
  "search.exclude": {
    "**/dist/**": true,
    "**/out/**": true,
    "**/*.asar": true
  },
  "files.exclude": {
    "**/*.asar": true
  }
}
```

**推奨プロジェクト構造:**
```
your-electron-app/
├── .vscode/
│   └── settings.json  ← 上記設定を追加
├── src/
├── dist/              ← ビルド出力先（監視対象外）
├── out/               ← パッケージング出力先（監視対象外）
└── package.json
```

## Electronプロジェクト検出時の動作

このスキルは以下の条件でElectronプロジェクトを検出した場合、自動的にロードされます：
- `package.json` に `electron` が依存関係として含まれている
- ユーザーがElectronアプリの実装を依頼した

## 実装時のチェックリスト

Electronアプリを実装する際は、以下を確認してください：

- [ ] renderer側で `alert()` / `confirm()` / `prompt()` を使っていないか
- [ ] `package.json` で Vite v5 を指定しているか
- [ ] `.vscode/settings.json` で `*.asar` を除外しているか
- [ ] セキュリティ設定（`nodeIntegration: false`, `contextIsolation: true`）を適切に設定しているか

---

**参考リンク:**
- [Electron issue #22923](https://github.com/electron/electron/issues/22923) - Windows環境でのdialog問題
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
