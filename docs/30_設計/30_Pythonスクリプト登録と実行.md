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
    inputs=["samples", "labels"],
    outputs=["score", "loading"],
)
def main(inputs, outputs, params):
    ...
```

### app が読むもの

- `display_name`
- `description`
- `inputs`
- `outputs`

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
  score: auto
  loading: auto
```

`.idts` が既に決まっている場合は `in:` の値へその path を入れる。

## 4. input 割当

各 input slot には次を指定できる。

- 既存 dataset 1 つ
- original data 複数選択

original data 複数選択の場合:

1. ユーザーが source dataset 名を決める
2. app が新しい source dataset を作る
3. source dataset は visible `.idts` として保存される
4. app は source dataset に紐づく data-note を system-managed に作る
5. block source の `in:` には source dataset の `.idts` path を書く

## 5. output 宣言

- output slot 名は decorator から決まる
- 初期状態では note source 上の value は `auto`
- 実行成功後は output slot ごとの visible `.idts` path を note source の `out:` へ書き戻す
- output dataset の system 既定名は `{解析名}_{slot名}_yyyyMMddHHmm` とする

## 6. 実行準備

app は実行前に次を行う。

1. input `.idts` を `datasetId` に解決する
2. input dataset を executable path に resolve する
3. output slot ごとに visible `Data/{dataset-name}.idts` manifest と実データ directory を確保する
4. `analysis-args.json` を `.store/.integral/runtime/BLK-.../` に書く

## 7. analysis-args.json

最小例:

```json
{
  "inputs": {
    "samples": "C:\\Workspace\\.store\\runtime\\resolved\\DTS-7K2M9Q4D",
    "labels": "C:\\Workspace\\.store\\runtime\\resolved\\DTS-1A2B3C4D"
  },
  "outputs": {
    "score": "C:\\Workspace\\.store\\objects\\DTS-9X4Q2M1A",
    "loading": "C:\\Workspace\\.store\\objects\\DTS-1B2C3D4E"
  },
  "params": {
    "n_components": 2
  }
}
```

### ルール

- 値は絶対パスまたは `null`
- input path は current path をそのまま使う場合も、staging path の場合もある
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

- output dataset が空でも成功なら空の結果として確定する
- stdout / stderr は `.store/.integral/runtime/BLK-.../` に残してよい
- 実行成功後、app は output slot ごとの visible `.idts` path を block source の `out:` に反映してよい

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
