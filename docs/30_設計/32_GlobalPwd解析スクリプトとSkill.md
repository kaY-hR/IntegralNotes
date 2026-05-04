# global / pwd の解析スクリプトと skill

## 目的

解析スクリプトと AI skill を、workspace (`pwd`) と user/global の両方から使えるようにする。

MVP では配布 manifest / registry / import workflow は作り込まない。
まずは既存の `run: path.py:function` 形式を拡張し、外部 path を直接扱えるようにする。

## Python 解析スクリプト

### 種別

- workspace script
  - workspace 内の `.py`
  - `run: scripts/pca.py:main`
- external/global script
  - user/global stock や vendor plugin 配下の `.py`
  - `run: %LocalAppData%/IntegralNotes/analysis-stock/pca.py:main`
  - `run: %LocalAppData%/IntegralNotes/plugins/vendor-name/blocks/export.py:main`

### 保存形式

`run:` は次を許可する。

- workspace relative path
- absolute path
- `%LocalAppData%` / `%AppData%` / `%UserProfile%` で短縮した absolute path

実行時は環境変数 token を展開して実 path に戻す。

### discovery

`>` popup の Python block 候補は次を混ぜて表示する。

- workspace 内の `.py`
- `%LocalAppData%/IntegralNotes/analysis-stock` 配下の `.py`
- `%LocalAppData%/IntegralNotes/plugins` 配下の `.py`

いずれも `@integral_block(...)` 直下の top-level function を候補にする。

表示例:

```text
PCA
scripts/pca.py:main
```

```text
Export Chromatogram
%LocalAppData%/IntegralNotes/plugins/shimadzu-lc/blocks/export.py:main
```

### import / copy

MVP では external/global script を workspace に自動 copy しない。
block は external path を直接 `run:` に持つ。

workspace の `.py` を再利用したい場合は、file tree の context menu から「ユーザーストックに追加」を実行できる。
この操作は対象 `.py` を `%LocalAppData%/IntegralNotes/analysis-stock` に copy する。

再現性を workspace 単位で固定したい場合は、後続で「external script を workspace にコピーして固定化」操作を追加する。

### 別 PC での扱い

external/global script は別 PC で同じ path / stock / plugin が無い場合に実行できない。
MVP ではその場合、外部 script が見つからない error として扱う。

将来、配布や再現性を強める必要が出たら、manifest / registry による stable ID 解決を検討する。

## AI skill

### 種別

- project skill
  - workspace の `.codex/skills`
  - workspace の `Notes/.codex/skills`
- global skill
  - `%LocalAppData%/IntegralNotes/skills`
  - `%UserProfile%/.codex/skills`

### 使い方

skill は解析結果の provenance source of truth ではないため、workspace へ import しなくても直接使える。

同名 skill が複数ある場合は、次の優先順にする。

1. workspace `.codex/skills`
2. workspace `Notes/.codex/skills`
3. `%LocalAppData%/IntegralNotes/skills`
4. `%UserProfile%/.codex/skills`

UI では skill の出所を `project:` / `global:` として表示する。

## MVP でやらないこと

- external script の自動 import / copy
- vendor plugin manifest からの stable ID 解決
- global script の rename / delete UI
- 別 PC への移行補助
- Python 依存関係の自動解決
