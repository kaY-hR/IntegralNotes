# block 記法設計

## 目的

block の user-facing source と app 内部の正規化表現を定義する。

## 1. user-facing canonical form

note source 上の block は、`itg-notes` code block の中に YAML 風の簡易記法で保存する。
JSON 互換は持たず、user-facing source は YAML のみを受け付ける。

### Python block

```itg-notes
id: BLK-1F8E2D0A
run: scripts/pca.py:main
in:
  samples: /Data/samples.idts
  labels: /Data/labels.idts
params:
  n_components: 2
out:
  score: auto
  loading: auto
```

### generic plugin block

```itg-notes
id: BLK-6D3C2B1A
use: shimadzu-lc/run-sequence
in:
  method: /Data/method.idts
params:
  methodName: Gradient 01
out:
  raw-result: auto
```

## 2. 各キーの意味

- `id`
  - block ID
  - `BLK-...`
  - 省略時は app が保存時に補完
- `run`
  - Python shorthand
  - `relative/path.py:function`
  - 内部では `plugin = "general-analysis"` に正規化する
- `use`
  - generic plugin shorthand
  - `plugin-id/block-type`
- `in`
  - slot 名 -> `.idts path`
- `params`
  - free-form object
- `out`
  - output slot 宣言
  - 未実行 slot は `auto`
  - 実行後は生成された `.idts` path を保持してよい

## 3. internal normalized form

app 内部では次の JSON object に正規化する。

```json
{
  "id": "BLK-1F8E2D0A",
  "plugin": "general-analysis",
  "block-type": "scripts/pca.py:main",
  "params": {
    "n_components": 2
  },
  "inputs": {
    "samples": "DTS-7K2M9Q4D",
    "labels": "DTS-1A2B3C4D"
  },
  "outputs": {
    "score": null,
    "loading": null
  }
}
```

## 4. 正規化ルール

### `run`

`run: scripts/pca.py:main` は次へ正規化する。

- `plugin = "general-analysis"`
- `block-type = "scripts/pca.py:main"`

### `use`

`use: shimadzu-lc/run-sequence` は次へ正規化する。

- `plugin = "shimadzu-lc"`
- `block-type = "run-sequence"`

### `in`

- `.idts` path を app が `datasetId` に解決する
- 解決できない場合は validation error にする

### `out`

- 未実行 slot は `auto`
- 実行後は visible output dataset の `.idts` path を書き戻してよい
- internal normalized form では `auto` を `null` にする
- `.idts` path が入っている場合はその文字列を保持する

## 5. 保存ルール

- note source は「何を実行するか」を残す
- 入力変更以外の source は極力安定に保つ
- ただし `out:` には最新実行で生成された `.idts` path を書き戻してよい
- run status と log 要約は hidden metadata ではなく UI state / runtime log で扱う

## 6. block card 表示

block card では次を表示してよい。

- display name
- `run` または `use`
- input / output slot と現在の dataset 名
- param 要約
- output slot 一覧
- hidden metadata から読んだ最新実行状態

## 7. 非対応

MVP では次を block source に入れない。

- 実行コマンド
- Python の実行パス
- 元ファイルの絶対パス
- 一時ログ
- run ID
- kind 制約 enforcement 情報
