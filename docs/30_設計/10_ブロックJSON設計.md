# block 記法設計

## 目的

block の user-facing source と app 内部の正規化表現を定義する。

未リリース PoC のため、旧形式との互換は持たない。

## 1. user-facing canonical form

note source 上の block は、`itg-notes` code block の中に YAML 風の簡易記法で保存する。
JSON 互換は持たず、user-facing source は YAML のみを受け付ける。

### Python block

authoring 時は、input に workspace path を書ける。

```itg-notes
id: BLK-1F8E2D0A
run: scripts/pca.py:main
in:
  samples: /Data/samples.csv
  labels: /Data/labels.csv
params:
  n_components: 2
out:
  score: /Results/score.csv
  report: /Results/report.html
```

保存または実行前には、`in:` は managed data ID に正規化する。

```itg-notes
id: BLK-1F8E2D0A
run: scripts/pca.py:main
in:
  samples: FL-7K2M9Q4D
  labels: FL-1A2B3C4D
params:
  n_components: 2
out:
  score: /Results/score.csv
  report: /Results/report.html
```

実行成功後は、`out:` も生成された managed data ID に書き換える。

```itg-notes
id: BLK-1F8E2D0A
run: scripts/pca.py:main
in:
  samples: FL-7K2M9Q4D
  labels: FL-1A2B3C4D
params:
  n_components: 2
out:
  score: FL-9X4Q2M1A
  report: FL-3N8K7Q2P
```

### generic plugin block

```itg-notes
id: BLK-6D3C2B1A
use: shimadzu-lc/run-sequence
in:
  method: FL-7K2M9Q4D
params:
  methodName: Gradient 01
out:
  raw-result: /Results/raw-result.lcd
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
  - slot 名 -> managed data ID
  - authoring 時だけ workspace path も許容し、保存または実行前に ID へ解決する
- `params`
  - decorator `params` schema に沿って正規化された object
  - schema が無い callable では `{}` とし、YAML 側の schema 外 param は保存・フォーム反映・実行前正規化で削除してよい
- `out`
  - 実行前: slot 名 -> workspace output path
  - 実行後: slot 名 -> 生成された managed data ID
  - note への自動反映可否や投影先 input は block source ではなく block 定義側で持つ

## 3. internal normalized form

app 内部では次の JSON object に正規化する。

実行前:

```json
{
  "id": "BLK-1F8E2D0A",
  "plugin": "general-analysis",
  "block-type": "scripts/pca.py:main",
  "params": {
    "n_components": 2
  },
  "inputs": {
    "samples": "FL-7K2M9Q4D",
    "labels": "FL-1A2B3C4D"
  },
  "outputs": {
    "score": "/Results/score.csv",
    "report": "/Results/report.html"
  }
}
```

実行後:

```json
{
  "id": "BLK-1F8E2D0A",
  "plugin": "general-analysis",
  "block-type": "scripts/pca.py:main",
  "params": {
    "n_components": 2
  },
  "inputs": {
    "samples": "FL-7K2M9Q4D",
    "labels": "FL-1A2B3C4D"
  },
  "outputs": {
    "score": "FL-9X4Q2M1A",
    "report": "FL-3N8K7Q2P"
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

- managed data ID はそのまま保持する
- workspace path が書かれている場合は、current path index で managed file / dataset ID へ解決する
- 解決できない場合は validation error にする
- `.idts` path は dataset ID へ解決する

### `out`

- 実行前は workspace path を保持する
- `.idts` output slot の場合、実行前 `out:` は `.idts` file path ではなく output folder path として扱う
- app は実行成功後に output folder 内へ `{folder名}.idts` manifest を作る
- 実行成功後、app は生成された managed file / dataset ID を書き戻す
- 実行後の `out:` に path は残さない
- `auto`、`dir`、`name`、`latest`、`outputConfigs` は canonical には含めない

## 5. 保存ルール

- note source は「何を実行したか」を残す
- input は ID で保存し、path/hash tracking の結果を current path として UI に表示する
- 実行前 output は希望保存先 path として保存する
- 実行後 output は生成物 ID として保存する
- 実行済み block は provenance として扱い、UI は read-only 表示にする
- 実行済み block は Delete と Undo だけ可能にし、再実行 button は出さない
- Undo は生成済み managed output の file / dataset folder、metadata、data-note、Markdown link / embed 参照を整理し、同じ block 定義から新しい block ID / 初期 input / 初期 params / 新しい output path を持つ draft を作り直す
- 再実行したい場合は、Undo で新しい draft に戻すか、ユーザーまたは LLM が新しい block を作る
- run status と log 要約は hidden metadata ではなく UI state / runtime log で扱う

## 5.5. note projection metadata

作業 note や data-note への自動反映は block source には保存しない。  
その情報は Python callable / plugin 定義の output slot 側 metadata として持つ。

例:

```python
{
    "name": "plot",
    "extension": ".html",
    "datatype": "demo/html-report",
    "auto_insert_to_work_note": True,
    "share_note_with_input": "source",
    "embed_to_shared_note": True,
}
```

app はこの metadata を読み、実行成功後に

- block 直下への `![]()`
- `share_note_with_input` で解決した共有先 data-note 末尾への provenance link + `![]()`

を append-only で反映してよい。

`![]()` へ挿入する target は通常 Markdown image と同じく path 表記にする。
ID から current path を解決できない場合は、app が表示時に未解決として扱う。

## 6. block card 表示

block card では次を表示してよい。

- display name
- `run` または `use`
- input / output slot
- input / output ID に対応する current path / display name
- param 要約
- 実行前 block の run action
- 実行済み block の read-only provenance 表示
- 実行済み block の Delete / Undo action
- data-note open action

## 7. 非対応

MVP では次を block source に入れない。

- 実行コマンド
- Python の実行パス
- 元ファイルの絶対パス
- 一時ログ
- run ID
- datatype 継承 / 互換 rule の enforcement 情報
- `outputConfigs`
- `out.*.dir/name/latest`
- `auto` output placeholder
