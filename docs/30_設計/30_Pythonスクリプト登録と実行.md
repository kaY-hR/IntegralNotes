# Python スクリプト登録と実行

## 前提

- plugin ID は `general-analysis`
- block-type は `PYS-...`
- `params` は常に `{}`
- `inputs / outputs` は `Record<string, string | null>`

## 1. 新規 Python block 作成フロー

### 入力

ユーザーは次を指定する。

- entry の `.py`
- 同梱ファイル
- input slot 名
- output slot 名
- displayName
- description

### 自動同梱

- entry と同階層の `.py` は自動同梱する

### 手動同梱

- 非 `.py`
- 別階層

はユーザー選択で追加する。

### 処理

app は次を行う。

1. `PYS-...` を採番
2. `.py-scripts/PYS-.../` を作る
3. entry と同梱ファイルをコピーする
4. `script.json` を作る
5. block をノートへ挿入する

## 2. script.json

最小形:

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

### 補足

- `displayName` は任意
- 未設定なら `entry` のファイル名を表示名に使う
- `description` も任意

## 3. 既存 script 再利用フロー

1. `.py-scripts/` を走査して script 一覧を出す
2. `displayName` と `description` を表示する
3. ユーザーは 1 つ選ぶ
4. app は `inputSlots / outputSlots` に従って block を作る

このとき slot 定義は block ごとに変更しない。

## 4. block 生成

`script.json` から block を作るときの例:

```json
{
  "id": "BLK-1F8E2D0A",
  "plugin": "general-analysis",
  "block-type": "PYS-7K2M9Q4D",
  "params": {},
  "inputs": {
    "samples": null
  },
  "outputs": {
    "result": null
  }
}
```

## 5. input 割当

各 input slot には次を指定できる。

- 既存 dataset 1 つ
- original data 複数選択

original data 複数選択の場合:

1. app が新しい source dataset を作る
2. source dataset は `.store/{datasetId}/` に普通の file / directory 群として materialize される
3. block の input には source dataset の `CNK-...` を書く

## 6. output 割当

- output slot 名は先に block に書く
- value は最初 `null`
- 実行時に app が output dataset を新規作成して `CNK-...` を書き戻す

## 7. 実行準備

app は実行前に次を行う。

1. input dataset を確認する
2. output slot ごとに新しい dataset フォルダを作る
3. `analysis-args.json` を `.py-scripts/PYS-.../` に書く

## 8. analysis-args.json

最小例:

```json
{
  "inputs": {
    "samples": "C:\\Workspace\\.store\\CNK-7K2M9Q4D"
  },
  "outputs": {
    "result": "C:\\Workspace\\.store\\CNK-9X4Q2M1A"
  },
  "params": {}
}
```

### ルール

- 値は絶対パスまたは `null`
- `blockId` は渡さない
- `params` は常に `{}` とする

## 9. 実行

実行方法:

1. `PYS-...` フォルダを current working directory にする
2. entry を Python で起動する
3. `analysis-args.json` を読ませる

### 成功判定

- exit code 0: 成功
- それ以外: 失敗

### 補足

- output dataset が空でも成功なら空の結果として確定する
- stdout / stderr は log に残す

## 10. script 更新

### 同一 ID を維持するケース

- `.py-scripts/PYS-.../` 内を直接編集した

### 新しい ID を作るケース

- 外部 `.py` を改めて登録した

### 任意オプション

- 外部登録時に「既存 `PYS-...` を上書き」があってよい

