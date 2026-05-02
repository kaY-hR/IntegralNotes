# Electron から Python を呼ぶ仕組み

## 目的

IntegralNotes が Electron app として Python callable をどう発見し、どう実行し、どこで SDK を解決するかを整理する。

## 前提

- Python callable は `general-analysis` plugin として扱う
- user-facing source は YAML `itg-notes`
- Python callable の canonical ID は `relative/path.py:function`
- user script の import 契約は `from integral import integral_block`

## 1. 役割分担

### renderer

- editor 上で `>` popup を開く
- callable 候補を表示する
- 選択時に `run: relative/path.py:function` を持つ YAML `itg-notes` block を挿入する

### main process

- workspace 内 `.py` を走査する
- `@integral_block(...)` 付き関数を block 候補として catalog 化する
- block 実行時に dataset 解決、runtime ディレクトリ作成、Python process 起動を行う

### Python SDK

- `integral_block` decorator を提供する
- decorator metadata を Python 側の正式契約として定義する

### user script

- `from integral import integral_block` で decorator を import する
- `inputs`, `outputs`, `params` を受け取る関数を実装する

## 2. discovery

main process は workspace root を再帰走査し、`.py` file を集める。  
現行 MVP の検出契約は regex ベースで、少なくとも次の形を拾う。

```python
@integral_block(...)
def main(...):
    ...
```

つまり current implementation が前提にするのは:

- decorator 名は `integral_block`
- `@integral_block(...)` の直後に `def ...(` が続く

という構文である。

decorator 引数から読むもの:

- `display_name`
- `description`
- `inputs`
- `outputs`

これらを block catalog の metadata に変換し、renderer の `>` popup 候補へ流す。

## 3. block source

renderer は callable 候補を選ぶと、次のような YAML block を note へ挿入する。

```itg-notes
id: BLK-1F8E2D0A
run: scripts/demo_hello_report.py:main
in: {}
params: {}
out:
  report: /Data/report_A1B.html
```

`run:` は app 内部で次へ正規化する。

- `plugin = "general-analysis"`
- `block-type = "scripts/demo_hello_report.py:main"`

## 4. 実行準備

main process は block 実行時に次を行う。

1. block source を internal normalized form に変換する
2. `in:` に path が残っていれば managed data ID へ解決する
3. input ID を current filesystem path に解決する
4. input が `.idts` dataset ID なら executable directory path に解決する
5. 非 `.idts` output は `out:` の target file path をそのまま使う
6. `.idts` output は visible manifest path と hidden bundle directory を確保する
7. `.store/.integral/runtime/BLK-.../analysis-args.json` を書く
8. 実行成功後は output slot ごとの生成 managed data ID を block source の `out:` に反映する
9. 実行済み block は provenance として read-only 表示にする

`analysis-args.json` の責務は、Python callable へ渡す filesystem-oriented payload を固定形で表現することにある。

最小例:

```json
{
  "inputs": {
    "source": "C:\\Workspace\\Data\\samples"
  },
  "outputs": {
    "report": "C:\\Workspace\\Data\\report.html"
  },
  "params": {
    "title": "Hello Integral"
  }
}
```

## 5. Python 起動

main process は `python -c <runner> <scriptPath> <functionName> <argsPath> <sdkImportRoot>` の形で Python process を起動する。

runner の責務:

1. `sdkImportRoot` を受け取る
2. `sdkImportRoot` を `sys.path` の先頭へ追加する
3. `analysis-args.json` を読む
4. target script を file path から import する
5. target function を取得する
6. `inputs`, `outputs`, `params` keyword arguments で呼び出す

つまり Electron が Python を「認識する」というより、Electron main process が:

- Python executable を見つける
- SDK path を教える
- 引数 payload を JSON で渡す
- target callable を runner 経由で呼ぶ

という orchestration をしている。

## 6. Python SDK の配置

正式な Python SDK は次に置く。

- `scripts/integral/__init__.py`

この package が提供する主 API:

- `integral.integral_block`
- `integral.get_integral_block_spec`
- `integral.IntegralBlockSpec`

### 開発時

app / runner は workspace の import root を次で解決する。

- `scripts/`
- app は authoring 補助として `cwd/.vscode/settings.json` に `python.analysis.extraPaths = ["./scripts"]` と `python.autoComplete.extraPaths = ["./scripts"]` を補助設定してよい

### packaged app

packaging 時に `Notes/` の中身を app resource の workspace template として同梱する。  
app はその中の `scripts/integral` を template source として使い、workspace の `scripts/integral/` へ同期する。

- `process.resourcesPath/workspace-template/scripts/integral`

runner 自体は同期後の workspace `scripts/` を `sys.path` へ追加する。

Python executable 自体は次で上書きできる。

- `INTEGRALNOTES_PYTHON`

## 7. なぜ sys.modules shim ではなく SDK path 追加か

旧方式は app runner が `sys.modules["integral"]` に no-op module を差し込む方式だった。  
これは import を通すだけの暫定策としては軽いが、次の弱みがあった。

- decorator API の正式な所在が不明確
- user が手元 Python から import して試しづらい
- app 内部実装と user-facing contract が分離していない

workspace package 同期方式にすると:

- `integral` package の実体が workspace の `scripts/integral/` に見える
- user script が app 実装詳細ではなく SDK を import できる
- app 実行時と authoring 時で同じ import 先を見られる

## 8. 現行制約

- discovery はまだ regex ベースであり、Python AST 実行や import ベースではない
- decorator の存在は SDK で正式化したが、catalog 生成は SDK runtime introspection を使っていない
- target callable の実行シグネチャは `inputs`, `outputs`, `params` を前提にする
- Python 環境や dependency install は user 管理であり、app は Python executable 自体を provision しない

## 9. デモ script

SDK を使う最小デモ:

- `scripts/demo_hello_report.py`

少し実用寄りのデモ:

- `scripts/demo_dataset_report.py`

どちらも `from integral import integral_block` を使い、scan 対象になる。
