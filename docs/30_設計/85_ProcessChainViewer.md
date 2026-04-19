# Process Chain Viewer

## 目的

現在見ている note / file を起点に、block と file の処理 chain を可視化する。

- block の input / output
- managed file / dataset の `createdByBlockId`
- note をまたいだ直系 lineage 上の block / file

を 1 つの graph として辿れるようにする。

## 配置

- Activity Bar から開く main workspace tab
- sidebar view ではない
- app core へ直書きせず、optional な internal workspace-tool plugin として登録する

理由:

- 後から機能ごと外しやすくしたい
- 現状の external plugin API は iframe sidebar view 向けであり、この viewer が必要とする app state 共有には向いていない

## 起点

- active tab が Markdown note の場合:
  - その note 内にある全 Integral block を並列 root にする
- active tab が通常 file の場合:
  - その file node を root にする
- process chain viewer tab 自体が active な間は、最後に focus していた通常 workspace tab を起点として使う

## グラフ生成

node:

- block node
- file node

edge:

- `file -> block`
  - block input
- `block -> file`
  - block output
- `block -> file`
  - managed file / dataset の `createdByBlockId`

探索:

- note を起点にした場合:
  - root はその note 内の全 block
  - 各 root block から upstream には「その block の input を生成した block」だけを再帰的に辿る
  - 各 root block から downstream には「その block の output を input として使う block」だけを再帰的に辿る
  - ancestor を辿っている途中で、その ancestor の別 child branch は辿らない
  - descendant を辿っている途中で、その descendant の別 parent branch は辿らない
- file を起点にした場合:
  - その file の producer / consumer block を直接の ancestor / descendant として辿る
- `.json` や derived file も特別扱いせず、普通の file node として出す

言い換えると、shared input を使っているだけの sibling / cousin block は描画しない。

## edge / port

- すべての edge は data flow の向きで描画する
- out-port は常に node の右
- in-port は常に node の左
- column 上の相対位置に関係なく、接続点は `source right -> target left` で固定する

## node click

- block node:
  - `note-path#BLK-...` を開く
- file node:
  - 通常の workspace file open 導線を使う
  - unsupported file は既存仕様どおり外部アプリへ回してよい

## 初版でやること

- read-only viewer
- card 風 node と bezier edge の簡易 graph
- fixed port 表示
- loading / empty / error state
- Refresh button

## 初版でやらないこと

- graph 上での block 編集
- graph 上での再実行
- file hover preview
- レイアウト編集
- 汎用 external plugin 化

## 実装メモ

- `src/renderer/workspaceToolPlugins.tsx`
  - internal workspace-tool plugin registry
- `src/renderer/ProcessChainViewer.tsx`
  - graph 構築と描画
- `src/renderer/App.tsx`
  - Activity Bar item / main tab / current context の接続
- `src/renderer/styles.css`
  - viewer UI
