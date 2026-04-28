# Python 汎用解析プラグイン

## 目的

`general-analysis` plugin の役割と、なぜこの plugin を用意するかを整理する。

## この plugin の位置づけ

`general-analysis` plugin は、

- 共通 block schema を使う
- workspace の `.py` を走査する
- decorator 付き関数を Python block として扱う

ための汎用 plugin である。

## Python Callable

`general-analysis` plugin が扱う解析は、workspace 内の `.py` file に定義された decorator 付き関数である。

### canonical ID

各 callable は

- `relative/path.py:function`

を canonical な block-type とする。

### decorator 例

```python
from integral import integral_block

@integral_block(
    display_name="PCA",
    description="CSV から PCA を計算する",
    inputs=[
        {"name": "samples", "extensions": [".csv"], "format": "table/csv"}
    ],
    outputs=[
        {"name": "score", "extension": ".csv", "format": "table/pca-score"},
        {"name": "report", "extension": ".html", "format": "report/html"},
    ],
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

## Discovery

app は workspace を scan して callable 一覧を作る。

`>` popup の表示例:

- 主表示: `PCA`
- 補助表示: `scripts/pca.py:main`

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

object form の slot 定義を読む必要があるため、discovery parser は string shorthand だけでなく dict literal も解釈できる必要がある。

## Block Type

Python block では

- `plugin = "general-analysis"`
- `block-type = "relative/path.py:function"`

とする。

## 実行

### source of truth

- workspace 上の `.py` file 自体を source of truth にする
- `.py-scripts/` のような専用コピー領域は持たない
- helper module や隣接 file も、通常の workspace file として扱う

### analysis-args.json

Python へ渡す実行情報は `analysis-args.json` にまとめる。

最小例:

```json
{
  "inputs": {
    "samples": "C:\\Workspace\\Data\\samples.csv",
    "source": "C:\\Workspace\\.store\\objects\\MF-1A2B3C4D"
  },
  "outputs": {
    "score": "C:\\Workspace\\Results\\score.csv",
    "bundle": "C:\\Workspace\\.store\\objects\\MF-9X4Q2M1A"
  },
  "params": {
    "n_components": 2
  }
}
```

### ルール

- `inputs` は絶対 path または `null`
- `outputs` は絶対 path または `null`
- note source 上の `in:` は managed data ID を正とし、実行時に current path へ解決する
- 非 `.idts` input は ID から解決した current file path を渡す
- `.idts` input は dataset ID から hidden bundle directory path に resolve して渡す
- note source 上の `out:` は実行前 target path、実行後 output managed data ID とする
- 非 `.idts` output は実行前 `out:` の target file path をそのまま渡す
- `.idts` output は hidden bundle directory path を渡す
- `params` は free-form object をそのまま渡す
- runner が `analysis-args.json` を読んだ上で target callable を `inputs`, `outputs`, `params` 引数で呼び出す
- 実行成功後、app は output metadata を作成または更新し、block source の `out:` を生成された ID へ書き換える

## decorator の所在

`from integral import integral_block` の decorator は、repo 内の Python SDK として定義する。

定義場所:

- `scripts/integral/__init__.py`

app は必要に応じてこの package を workspace の `scripts/integral/` へ同期し、runner は `scripts/` を `sys.path` の先頭へ追加して import を成立させる。

## 成功判定

- exit code が 0 なら成功
- それ以外は失敗

output path が file でも bundle でも、成功した場合は app が metadata を更新する。
