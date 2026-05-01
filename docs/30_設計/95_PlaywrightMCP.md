# Playwright MCP

## 目的

Codex などの外部 agent が IntegralNotes を自分で起動し、画面を観察し、クリックや入力を行って動作確認できるようにする。

この MCP は IntegralNotes アプリ内の AI Chat 用 MCP client registry ではない。外部 MCP client から起動する開発用サーバーである。

## 起動

```powershell
node C:\Users\shimadzu\Desktop\_Root\10_Integral\IntegralNotes\mcp-server-impl\src\dev\integral-playwright-mcp.mjs
```

Codex 側の MCP server 設定例:

```json
{
  "mcpServers": {
    "integralnotes-playwright": {
      "command": "node",
      "args": [
        "C:\\Users\\shimadzu\\Desktop\\_Root\\10_Integral\\IntegralNotes\\mcp-server-impl\\src\\dev\\integral-playwright-mcp.mjs"
      ]
    }
  }
}
```

stdio MCP では stdout を JSON-RPC protocol 専用にする必要があるため、Codex などから登録するときは npm の lifecycle log を避けて direct `node` 起動にする。

## worktree ごとの Codex 登録

Codex の MCP 設定は global なので、worktree ごとに MCP 名を分けて登録する。

worktree root で次を実行する。

```bat
scripts\register-codex-playwright-mcp.bat
```

既定の MCP 名は `integralnotes-playwright-<カレントフォルダ名>`。

任意の名前で登録する場合:

```bat
scripts\register-codex-playwright-mcp.bat integralnotes-playwright-my-worktree
```

worktree を消す前に解除する場合:

```bat
scripts\unregister-codex-playwright-mcp.bat
```

任意名で登録した場合は同じ名前を渡す。

```bat
scripts\unregister-codex-playwright-mcp.bat integralnotes-playwright-my-worktree
```

登録 script は Codex に次の形の stdio server を登録する。

```powershell
codex mcp add <name> -- node <worktree>\src\dev\integral-playwright-mcp.mjs
```

## 提供 tools

- `integral_launch`: Vite renderer を起動または再利用し、Electron を Playwright 経由で起動する
- `integral_status`: 起動状態、window title、URL、必要に応じて child process log を返す
- `integral_snapshot`: DOM text と主要な interactive element の selector を返す
- `integral_click`: CSS selector、role/name、または text で要素をクリックする
- `integral_fill`: input / textarea / contenteditable に入力する
- `integral_press`: keyboard key を押す
- `integral_wait_for`: selector または text が表示されるまで待つ
- `integral_evaluate`: renderer page 内で JavaScript expression を評価する
- `integral_screenshot`: PNG screenshot を保存し、MCP image content として返す
- `integral_close`: Playwright 管理下の Electron app を閉じる

## 設計メモ

- MCP サーバーは stdout を protocol 専用にするため、renderer / build の出力は pipe して内部 buffer に保持する。
- `integral_launch` は `INTEGRALNOTES_USER_DATA_DIR` を指定して Electron の userData を一時領域へ分離する。
- `workspacePath` を指定すると `INTEGRALNOTES_DEFAULT_WORKSPACE` として渡し、起動時に対象 workspace を開く。
- Electron main が未 build の場合や `rebuildMain: true` の場合は `tsc -p tsconfig.node.json` を実行する。
- Playwright は Electron を操作するだけなので、ブラウザ download を避けるため `playwright-core` を使う。

## 依存

- `@modelcontextprotocol/sdk`
- `playwright-core`

`playwright-core` は browser binary を含まない。Electron binary は既存の `electron` dependency を使う。
