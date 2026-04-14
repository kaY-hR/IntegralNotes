# block JSON 設計

## 共通 schema

```json
{
  "id": "BLK-1F8E2D0A",
  "plugin": "plugin-id",
  "block-type": "type-id",
  "params": {},
  "inputs": {},
  "outputs": {}
}
```

## 各キーの意味

- `id`
  - block ID
  - `BLK-...`
  - 省略時は app が保存時に補完
- `plugin`
  - 担当 plugin ID
- `block-type`
  - plugin 内の stable type ID
- `params`
  - plugin 固有設定
- `inputs`
  - slot 名 -> `datasetId | null`
- `outputs`
  - slot 名 -> `datasetId | null`

## 型

MVP では次を正とする。

- `params`: `Record<string, unknown>`
- `inputs`: `Record<string, string | null>`
- `outputs`: `Record<string, string | null>`

補足:

- `inputs / outputs` の value に配列は持たない
- `1 slot = 1 dataset` を固定する
- UI 上の original data 複数選択は source dataset 生成で吸収する
- source dataset の実体は `.store/{datasetId}/` に普通の file / directory 群として materialize する

## Python block 例

```json
{
  "id": "BLK-1F8E2D0A",
  "plugin": "general-analysis",
  "block-type": "PYS-7K2M9Q4D",
  "params": {},
  "inputs": {
    "samples": "DTS-7K2M9Q4D"
  },
  "outputs": {
    "result": null
  }
}
```

## 装置 block 例

```json
{
  "id": "BLK-6D3C2B1A",
  "plugin": "shimadzu-lc",
  "block-type": "run-sequence",
  "params": {
    "methodName": "Gradient 01"
  },
  "inputs": {
    "method": "DTS-1A2B3C4D"
  },
  "outputs": {
    "raw-result": null
  }
}
```

## 標準表示 block 例

```json
{
  "id": "BLK-7A8B9C0D",
  "plugin": "core-display",
  "block-type": "dataset-view",
  "params": {},
  "inputs": {
    "source": "DTS-9X4Q2M1A"
  },
  "outputs": {}
}
```

## 保存ルール

- `outputs` の slot 名は block 作成時に先に書く
- 未実行時の output 値は `null`
- 未設定 input も `null` を許容する

## 実行後更新

実行後は app が `outputs` の `null` を `DTS-...` に更新する。

例:

実行前

```json
{
  "outputs": {
    "result": null
  }
}
```

実行後

```json
{
  "outputs": {
    "result": "DTS-9X4Q2M1A"
  }
}
```

## 非対応

MVP では次を block JSON に入れない。

- 実行コマンド
- Python の実行パス
- 元ファイルの絶対パス
- run ID
- kind 制約 enforcement 情報

