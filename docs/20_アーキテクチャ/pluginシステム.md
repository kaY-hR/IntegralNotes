# pluginシステム

## 目的

- `itg-notes` block の描画・実行ロジックを IntegralNotes 本体から分離し、独自 UI を段階的に外部 plugin 化できるようにする。
- Markdown に保存される JSON は plugin 非依存のデータとして残し、plugin 未導入時でもノート自体は壊さない。
- 実行ファイルをノート置き場とは分離し、ワークスペースを開いただけで任意コードが混入しない構成にする。

## 今回の結論

### plugin のインストール先

- 外部 plugin はワークスペース配下ではなく、Electron の `app.getPath("userData")` 配下に配置する。
- Windows では概ね `%APPDATA%\IntegralNotes\plugins\<pluginId>\` を想定する。
- こうしておくと、複数ワークスペースで同じ plugin を共有でき、ノート共有時に実行ファイルまで運ばれない。

### plugin が満たすべき制約

- plugin は `integral-plugin.json` を必須とする。
- plugin は `namespace` を 1 つ持ち、block の `type` は必ず `<namespace>.` で始める。
- renderer は sandbox 前提の web bundle とし、Node.js API を直接持たせない。
- 実行ファイルは renderer から直接起動せず、main process が `stdio` JSON プロトコルで仲介する。
- plugin 未導入または manifest 不正時は、block を汎用 preview に落として編集は継続可能にする。

### IntegralNotes 本体が plugin を認識する方法

1. 起動時に組み込み plugin を登録する。
2. `plugins` ディレクトリ直下の各サブディレクトリを走査する。
3. `integral-plugin.json` を読み、manifest を検証する。
4. block type の重複や namespace 不整合を弾く。
5. 有効な plugin 一覧を IPC で renderer に渡す。

## ディレクトリ構成

```text
%APPDATA%\IntegralNotes\
  plugins\
    shimadzu.lc\
      integral-plugin.json
      renderer\
        index.js
      bin\
        win32-x64\
          shimadzu-lc-host.exe
      schemas\
        LC.Method.Gradient.schema.json
```

- `renderer/index.js`
  - block 表示用の web bundle。
- `bin/win32-x64/...exe`
  - action 実行用のホストプロセス。
- `schemas/*.schema.json`
  - `params` 検証や editor 補助に使う任意ファイル。

## manifest 例

```jsonc
{
  "apiVersion": "1",
  "id": "shimadzu.lc",
  "namespace": "LC",
  "displayName": "Shimadzu LC Blocks",
  "version": "0.1.0",
  "description": "LC 系の独自 UI block を提供する plugin",
  "renderer": {
    "entry": "renderer/index.js",
    "mode": "iframe"
  },
  "executable": {
    "entry": "bin/win32-x64/shimadzu-lc-host.exe",
    "protocolVersion": "1"
  },
  "blocks": [
    {
      "type": "LC.Method.Gradient",
      "title": "LC Gradient",
      "description": "勾配プログラムを表示し、実行 action を提供する",
      "actions": [
        {
          "id": "execute",
          "label": "装置操作を実行",
          "busyLabel": "装置操作を送信中..."
        }
      ]
    }
  ]
}
```

## block JSON との関係

- ノート本文には plugin 実体ではなく block JSON だけを保存する。
- plugin の install/uninstall とノートデータを分離するため、JSON 側には executable path を書かない。
- 詳細な block JSON ルールは `docs/20_アーキテクチャ/jsonスキーマ.md` に寄せる。

## 実行フロー

1. Markdown の ```` ```itg-notes ```` を読み、JSON の `type` を得る。
2. renderer は `type` に対応する plugin block 定義を参照する。
3. renderer bundle があれば専用 UI を描画する。
4. ボタン操作などの action は IPC で main process に渡す。
5. main process が plugin executable を起動し、結果を renderer に返す。

## セキュリティと運用

- ワークスペース内のファイルは plugin として自動実行しない。
- plugin 実行は main process だけが担当し、renderer には Node 権限を与えない。
- block JSON は plugin 不在でも編集可能にし、ノートの可搬性を優先する。
- 将来的に署名検証や有効/無効切り替えを追加する余地を残す。

## 段階的な移行

### Step 3 でやること

- manifest の型を shared に定義する。
- main process に plugin 発見処理を追加する。
- 既存の `LC.Method.Gradient` と `StandardGraphs.Chromatogram` を組み込み plugin として再表現する。

### Step 4 でやること

- 外部 plugin の renderer bundle 読み込み。
- executable の起動と action protocol 実装。
- 現在の hard-coded UI を builtin plugin renderer として整理する。
