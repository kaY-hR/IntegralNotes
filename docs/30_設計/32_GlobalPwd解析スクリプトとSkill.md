# global / pwd の解析スクリプトと skill

## 目的

解析スクリプトと AI skill を、workspace (`pwd`) と IntegralNotes global / package の両方から扱えるようにする。

ただし、Python script は解析再現性に直結するため、実行時の source of truth を workspace 内の `.py` に寄せる。

## Python 解析スクリプト

### 種別

- workspace script
  - workspace 内の `.py`
  - `run: scripts/pca.py:main`
- package-imported script
  - package stock から workspace `.packages/{packageId}/scripts/` へ copy された `.py`
  - `run: .packages/image-analysis-pack/scripts/segment_cells.py:main`
- global script stock
  - `%LocalAppData%/IntegralNotes/global/scripts`
  - 直接実行する source ではなく、workspace へ copy して使う候補
- package script stock
  - `%LocalAppData%/IntegralNotes/packages/{packageId}/scripts`
  - package manifest の `exports.pythonBlocks` に載った callable だけを候補に出す

### 保存形式

`run:` は workspace relative path を正とする。

package 由来 script も、選択時に workspace `.packages/{packageId}/scripts/` へ copy してから、workspace relative path として保存する。

```yaml
run: .packages/image-analysis-pack/scripts/segment_cells.py:main
```

MVP では `%LocalAppData%/.../path.py:function` のような global absolute path を新規 block の canonical form にしない。

### discovery

`>` popup の Python block 候補は次を混ぜて表示する。

- workspace 内の通常 `.py`
- workspace `.packages/*/integral-package.json` の `exports.pythonBlocks`
- `%LocalAppData%/IntegralNotes/packages/*/integral-package.json` の `exports.pythonBlocks`

通常の workspace `.py` scan は `.packages` 配下を除外する。`.packages` 配下は manifest の `exports.pythonBlocks` に載った callable だけを候補にする。

package stock 側の candidate を選択した場合、app は次を行う。

1. `%LocalAppData%/IntegralNotes/packages/{packageId}` から workspace `.packages/{packageId}` へ `integral-package.json` と `scripts/` subtree を copy する
2. 既存 import と衝突する場合は user confirm を出し、許可された場合だけ上書きする
3. note へ `.packages/{packageId}/scripts/foo.py:function` の block を挿入する

表示例:

```text
Segment Cells
.packages/image-analysis-pack/scripts/segment_cells.py:main
```

### import / copy

package script は依存する別 `.py` helper を持つことがあるため、export された `.py` 単体ではなく package の `scripts/` subtree をまとめて copy する。
Python block と skill が共通利用する helper module は package root の `shared/` に置く。package stock 側では skill は `%LocalAppData%/IntegralNotes/packages/<packageId>/shared` を見て、workspace import 後の Python block は `.packages/<packageId>/shared` を見る。`skills/` 配下の SDK / helper は copy 対象外なので、Python block から直接 import しない。

copy 先:

```text
Workspace/
  .packages/
    image-analysis-pack/
      integral-package.json
      shared/
        image_io.py
      scripts/
        segment_cells.py
```

copy しないもの:

- `runtime-plugins/`
- `skills/`

`.packages` は hidden/system-managed path とし、hidden 表示 OFF の file tree では非表示にする。hidden 表示 ON では表示してよいが、managed file tracking の通常自動登録対象からは除外する。

### 別 PC での扱い

workspace `.packages/{packageId}/scripts/` に copy 済みの script は workspace 側に残るため、block 実行だけなら global package stock が無くても成立しうる。

ただし、package stock が無い場合は再 import、更新、runtime plugin / skill の利用ができない。MVP では missing package として warning を出してよい。

## AI skill

### 種別

- project skill
  - workspace の `.codex/skills`
  - workspace の `Notes/.codex/skills`
- global skill
  - `%LocalAppData%/IntegralNotes/global/skills`
- package skill
  - `%LocalAppData%/IntegralNotes/packages/*/integral-package.json` の `exports.skills`

### 使い方

skill は解析結果の provenance source of truth ではないため、workspace へ import しなくても直接使える。

Codex 本体の global skill (`%UserProfile%/.codex/skills`) は IntegralNotes の LLM には渡さない。

同名 skill が複数ある場合は、次の優先順にする。

1. workspace `.codex/skills`
2. workspace `Notes/.codex/skills`
3. `%LocalAppData%/IntegralNotes/global/skills`
4. package exported skill

UI では skill の出所を `project:` / `global:` / `package:` として表示する。

## MVP でやらないこと

- package dependency resolver
- external script の自動更新
- global script の rename / delete UI
- 別 PC への package stock 自動移行
- Python 依存関係の自動解決
