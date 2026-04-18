# Python callable discovery と実行

## 前提

- plugin ID は `general-analysis`
- block-type は `relative/path.py:function`
- `params` は free-form object
- `inputs / outputs` は internal normalized form では `Record<string, string | null>`

## 1. discovery

app は workspace 内の `.py` を走査し、decorator 付き関数を block 候補として収集する。

### decorator 例

```python
from integral import integral_block

@integral_block(
    display_name="PCA",
    description="数値テーブルに対して主成分分析を行う",
    inputs=[
        {"name": "samples", "extensions": [".csv"], "format": "table/csv"},
        {"name": "labels", "extensions": [".csv"], "format": "table/csv"},
    ],
    outputs=[
        {"name": "score", "extension": ".csv", "format": "table/pca-score"},
        {"name": "report", "extension": ".html", "format": "report/html"},
    ],
)
def main(inputs, outputs, params):
    ...
```

### app が読むもの

- `display_name`
- `description`
- `inputs`
- `outputs`
- slot ごとの `extension(s)` / `format`

### 現行 scan 条件

現行実装では regex ベースで次の形を検出する。

```python
@integral_block(...)
def main(...):
    ...
```

つまり MVP では:

- decorator 名は `integral_block`
- `@integral_block(...)` の直後に `def ...(` が続く

という構文を前提にする。

## 2. `>` popup

候補一覧では次を表示する。

- 主表示: `display_name`
- 補助表示: `relative/path.py:function`

例:

- `PCA`
- `scripts/pca.py:main`

## 3. block 生成

app は callable 定義から次の block source を作る。

```itg-notes
id: BLK-1F8E2D0A
run: scripts/pca.py:main
in:
  samples: null
  labels: null
params: {}
out:
  score: /Data/score.csv
  report: /Data/report.html
```

slot が `.idts` を要求する場合は、`in:` または `out:` に `.idts` path を入れる。

## 4. input 割当

各 input slot には次を指定できる。

- slot 制約に合う file path 1 つ
- `.idts` slot の場合は既存 dataset 1 つ
- `.idts` slot の場合は複数 managed file から新しい dataset を作る

`.idts` dataset を新しく作る場合:

1. ユーザーが dataset 名を決める
2. app が選択した managed file から新しい dataset を作る
3. dataset は visible `.idts` として保存される
4. app は dataset に紐づく data-note を system-managed に作る
5. block source の `in:` にはその `.idts` path を書く

## 5. output 宣言

- output slot 名は decorator から決まる
- 初期状態では各 slot に `extension` を踏まえた既定 path を入れる
- block card 上では `Inputs` / `Outputs` を section 分離して表示する
- output slot には保存先 path を編集できる UI を表示する
- `.idts` output の場合は manifest path を編集し、中身の hidden bundle directory は app が内部で確保する
- 実行成功後は output slot ごとの実際の file path または `.idts` path を note source の `out:` へ書き戻す

## 6. 実行準備

app は実行前に次を行う。

1. input path を検証する
2. input が `.idts` なら datasetId を解決し、runtime 用 directory path に resolve する
3. 非 `.idts` output は target file path をそのまま使う
4. `.idts` output は visible manifest path を確定し、hidden bundle directory を確保する
5. `analysis-args.json` を `.store/.integral/runtime/BLK-.../` に書く

## 7. analysis-args.json

最小例:

```json
{
  "inputs": {
    "samples": "C:\\Workspace\\Data\\samples.csv",
    "bundle": "C:\\Workspace\\.store\\.integral\\datasets\\staging\\DTS-7K2M9Q4D"
  },
  "outputs": {
    "score": "C:\\Workspace\\Results\\score.csv",
    "reportBundle": "C:\\Workspace\\.store\\objects\\DTS-9X4Q2M1A"
  },
  "params": {
    "n_components": 2
  }
}
```

### ルール

- 値は絶対パスまたは `null`
- 非 `.idts` input / output は current path をそのまま使う
- `.idts` input / output は runtime 用 directory path を渡す
- `params` は note source から読んだ object をそのまま渡す

## 8. 実行

実行方法:

1. workspace root を current working directory にする
2. callable を `relative/path.py:function` から解決する
3. runner が `analysis-args.json` を読む
4. runner が target callable を `inputs`, `outputs`, `params` 引数で呼び出す

### 成功判定

- exit code 0: 成功
- それ以外: 失敗

### 補足

- `.idts` output の中身が空でも成功なら空の結果として確定する
- stdout / stderr は `.store/.integral/runtime/BLK-.../` に残してよい
- 実行成功後、app は output slot ごとの file path または visible `.idts` path を block source の `out:` に反映してよい

## 9. decorator の import 契約

user script は次の import を前提にしてよい。

```python
from integral import integral_block
```

定義場所:

- `scripts/integral/__init__.py`

app は必要に応じてこの package を workspace の `scripts/integral/` へ同期し、runner は `scripts/` を `sys.path` へ追加して import を成立させる。

開発時:

- workspace の `scripts/`
- app は必要に応じて `cwd/.vscode/settings.json` に `python.analysis.extraPaths = ["./scripts"]` を補助設定してよい

packaged app:

- `process.resourcesPath/python-sdk/integral` を template source として保持し、workspace の `scripts/integral/` へ同期する

詳細は `docs/30_設計/35_ElectronからPythonを呼ぶ仕組み.md` を参照。

## 10. source of truth

- source of truth は workspace 上の `.py` file である
- app は `.py` や helper file を専用ディレクトリへ copy しない
- rename / move の追従が必要なら、後から workspace path tracking を足す
- `from integral import ...` をそのまま使いたい callable は `scripts/` 配下に置くのを推奨する
