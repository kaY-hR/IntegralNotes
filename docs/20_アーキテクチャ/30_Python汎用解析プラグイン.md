# Python 汎用解析プラグイン

## 目的

`general-analysis` plugin の役割と、なぜこの plugin を用意するかを整理する。

## この plugin の位置づけ

`general-analysis` plugin は、

- 共通 block schema を使う
- workspace の `.py` を走査する
- decorator 付き関数を Python block として扱う

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

## Python callable

`general-analysis` plugin が扱う解析は、workspace 内の `.py` file に定義された decorator 付き関数である。

### canonical ID

各 callable は

- `relative/path.py:function`

を canonical な block-type とする。

例:

- `scripts/pca.py:main`
- `analysis/normalize.py:run`

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

### decorator が持つ情報

- `display_name`
- `description`
- `inputs`
- `outputs`

MVP ではここに params schema は持たせない。  
`params` 自体は free-form object として note source から与える。

## discovery

app は workspace を scan して callable 一覧を作る。

`>` popup の表示例:

- 主表示: `PCA`
- 補助表示: `scripts/pca.py:main`

ユーザーが候補を選ぶと、app は `run:` を持つ `itg-notes` block を挿入する。

### 現行 scan 契約

現行実装では、workspace 内 `.py` を再帰走査し、少なくとも次の形を regex ベースで検出する。

```python
@integral_block(...)
def main(...):
    ...
```

つまり MVP 時点では、

- decorator 名は `integral_block`
- `@integral_block(...)` の直後に `def name(` が続く

という形を前提にしている。

## block-type

Python block では

- `plugin = "general-analysis"`
- `block-type = "relative/path.py:function"`

とする。

つまり callable 参照そのものが block-type になる。

## 実行

### source of truth

- workspace 上の `.py` file 自体を source of truth にする
- `.py-scripts/` のような専用コピー領域は持たない
- helper module や隣接 file も、通常の workspace file として扱う

### 実行場所

- current working directory は workspace root を基本とする
- app は callable を file path と function 名から解決して起動する
- 実行時の補助 file は `.store/.integral/runtime/BLK-.../` に置いてよい

### analysis-args.json

Python へ渡す実行情報は `analysis-args.json` にまとめる。

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

- `inputs` は絶対パスまたは `null`
- `outputs` は絶対パスまたは `null`
- `inputs` は current path をそのまま指す場合も、dataset-json を staging resolve した path の場合もある
- `params` は free-form object をそのまま渡す
- `blockId` は Python へ必須ではない
- user script 自体が `analysis-args.json` を読む前提ではない
- runner が `analysis-args.json` を読んだ上で target callable を `inputs`, `outputs`, `params` 引数で呼び出す

## decorator の所在

`from integral import integral_block` の decorator は、repo 内の Python SDK として定義する。

定義場所:

- `plugin-sdk/python/integral/__init__.py`

app runner は実行時にこの SDK root を `sys.path` の先頭へ追加し、user script の import を成立させる。

開発時:

- `plugin-sdk/python`

packaged app:

- `process.resourcesPath/python-sdk`

詳細は `docs/30_設計/35_ElectronからPythonを呼ぶ仕組み.md` を参照。

## 成功判定

- exit code が 0 なら成功
- それ以外は失敗

output dataset が空でも、成功なら空の結果として確定する。

## Python 環境

MVP では Python 環境を本体が管理しない。

- `.venv` はユーザー管理
- dependency install もユーザー管理
- app は「この callable を実行する」ことだけを担う

## 将来拡張

必要になれば、後から次を足せる。

- params schema
- kind 制約 enforcement
- import/file access 解析による依存候補サジェスト
- Python 実行環境の callable 単位指定
- sandbox 実行
