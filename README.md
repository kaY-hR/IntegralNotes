ソフトを起動し、Notesフォルダを開き、README.mdをご確認ください。

* node --version : v22.19.0
* npm --version : 10.9.3

## 開発者向け起動手順

初回:

```powershell
npm install
npm run build
```

開発起動:

```powershell
npm run dev
```

`npm run dev` は worktree root に `.integralnotes-dev.local.json` を自動作成する。この file は Git 管理外で、worktree ごとの Vite renderer port を保持する。

例:

```json
{
  "devPort": 5764,
  "playwrightArtifactDir": "C:\\Users\\shimadzu\\AppData\\Local\\Temp\\integralnotes-playwright-mcp\\mcp-server-impl-dc66d60f\\artifacts",
  "playwrightUserDataDir": "C:\\Users\\shimadzu\\AppData\\Local\\Temp\\integralnotes-playwright-mcp\\mcp-server-impl-dc66d60f\\user-data"
}
```

この設定により、複数 worktree で `npm run dev` しても `5173` を誤 reuse しない。

## Codex Playwright MCP

Codex から IntegralNotes を起動し、画面操作や screenshot 取得で動作確認するための開発用 MCP server を用意している。

worktree ごとに 1 回登録する:

```bat
scripts\register-codex-playwright-mcp.bat
```

登録名の既定値は `integralnotes-playwright-<カレントフォルダ名>`。

任意名で登録する場合:

```bat
scripts\register-codex-playwright-mcp.bat integralnotes-playwright-my-worktree
```

worktree を削除する前に解除する:

```bat
scripts\unregister-codex-playwright-mcp.bat
```

登録後は Codex を再起動する。MCP server は `node src/dev/integral-playwright-mcp.mjs` として起動され、`.integralnotes-dev.local.json` の port / userData / artifact dir を使う。

詳細は `docs/30_設計/95_PlaywrightMCP.md` を参照。
