# Python 汎用解析プラグイン

## 目的

`general-analysis` plugin の役割と、なぜこの plugin を用意するかを整理する。

## この plugin の位置づけ

`general-analysis` plugin は、

- 共通 block schema を使う
- `cwd/.py-scripts/` を走査する
- 任意の Python スクリプトを処理 block として扱う

ための汎用 plugin である。

これは「全解析の本体」ではなく、

- 汎用 UI で扱える解析
- Python で素早く書きたい解析

を受け持つ 1 plugin である。

## なぜ Python を個別 plugin にしないか

解析 1 本ごとに plugin を切ると、plugin 数が増えすぎる。  
一方、すべてを本体機能にすると、Python 特有の都合まで本体が背負うことになる。

そこで MVP では、

- 共通 block schema は本体
- Python 実行の都合は `general-analysis` plugin

に分ける。

## script 資産

`general-analysis` plugin が扱う解析は、`.py-scripts/PYS-.../` に保存される。

### script.json の最小形

```json
{
  "scriptId": "PYS-7K2M9Q4D",
  "displayName": "PCA",
  "description": "数値テーブルに対して主成分分析を行う",
  "entry": "pca.py",
  "inputSlots": [
    {
      "name": "samples"
    }
  ],
  "outputSlots": [
    {
      "name": "result"
    }
  ]
}
```

### slot 定義

MVP では slot 定義は最小限にする。  
ただし将来拡張のため、object 配列を採る。

入力 slot 例:

```json
{
  "name": "samples",
  "acceptedKinds": ["source-bundle"]
}
```

出力 slot 例:

```json
{
  "name": "result",
  "producedKind": "PYS-7K2M9Q4D.result"
}
```

補足:

- `acceptedKinds` / `producedKind` は MVP では enforcement しない
- ただし表現可能にしておく

## script 登録

新規登録時に app は次を聞く。

- entry の `.py`
- 同梱するファイル
- input slot 名
- output slot 名
- displayName
- description

### 自動同梱

- entry と同階層の `.py` は自動同梱する

### 手動同梱

- 非 `.py` ファイル
- 別階層ファイル

はユーザーが明示選択する。

### フラットコピー

同梱ファイルは MVP ではフラットにコピーする。  
元の相対ディレクトリ構造は保持しない。

## script の再利用

`PYS-...` は block ごとに作るのではなく、再利用可能資産とする。

### 再利用時

- script.json に定義された slot 名をそのまま使う
- block ごとには slot 定義を変えない

### 更新時

- `.py-scripts/PYS-.../` を直接編集した場合は同じ ID を使い続ける
- 外部 `.py` を再登録した場合は、既定では新しい `PYS-...` を作る
- 必要なら既存 `PYS-...` を上書き登録できる

## block-type

Python block では

- `plugin = "general-analysis"`
- `block-type = "PYS-..."`

とする。

つまり `scriptId` がそのまま block-type になる。

## 実行

### 実行場所

MVP では `.py-scripts/PYS-.../` 自体を実行場所として使う。  
別の sandbox は切らない。

### 許容すること

- 一時ファイルで多少汚れる
- log が残る

### なぜ許容するか

MVP では複雑さを増やさず、まず Python 実行を成立させることを優先するため。

## analysis-args.json

Python へ渡す実行情報は `analysis-args.json` にまとめる。

最小例:

```json
{
  "inputs": {
    "samples": "C:\\Workspace\\chunk\\CNK-7K2M9Q4D"
  },
  "outputs": {
    "result": "C:\\Workspace\\chunk\\CNK-9X4Q2M1A"
  },
  "params": {}
}
```

### ルール

- `inputs` は絶対パスまたは `null`
- `outputs` は絶対パスまたは `null`
- `params` は常に `{}` とする
- `blockId` は渡さない

## 成功判定

- exit code が 0 なら成功
- それ以外は失敗

output chunk が空でも、成功なら空の結果として確定する。

## Python 環境

MVP では Python 環境を本体が管理しない。

- `.venv` はユーザー管理
- dependency install もユーザー管理
- app は「この script を実行する」ことだけを担う

## 将来拡張

必要になれば、後から次を足せる。

- `params schema`
- kind 制約 enforcement
- import/file access 解析による同梱候補サジェスト
- Python 実行環境の per-script 指定
- 別 sandbox 実行
