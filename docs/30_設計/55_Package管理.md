# Package 管理

## 目的

runtime plugin、AI skill、Python block/helper、template を一式で配布できる単位として package を導入する。

package は dependency resolver ではなく、次のための管理単位である。

- 一式配布
- vendor 配布物の version 管理
- package 内 component の公開範囲管理
- 欠落検知
- 由来管理

Python script と skill 自体には個別 manifest を持たせない。package だけが `integral-package.json` を持つ。

## global extension root

拡張資産は dev / production で分けず、当面は `%LocalAppData%/IntegralNotes` に統一する。

Electron の `userData` は app settings、logs、chat history などの app 状態に使う。runtime plugin、package、global skill、global script の root には使わない。

```text
%LocalAppData%/IntegralNotes/
  global/
    skills/
    scripts/
  runtime-plugins/
  packages/
```

役割:

- `global/skills`
  - 単体で使える汎用 skill
- `global/scripts`
  - workspace へコピーして使う汎用 Python script stock
- `runtime-plugins`
  - package に属さない単体 runtime plugin の install 先
- `packages`
  - vendor package の install 先

旧 path は互換対象にしない。

```text
%AppData%/IntegralNotes/plugins
%AppData%/IntegralNotes-dev/plugins
%LocalAppData%/IntegralNotes/plugins
%LocalAppData%/IntegralNotes/analysis-stock
%LocalAppData%/IntegralNotes/skills
```

## package source

repo 内の `plugins/<name>` は、将来そのまま別 repo へ切り出せる source root とする。

`plugins/<name>` は runtime plugin 専用 root ではなく、package または standalone 配布単位の root である。

package source 例:

```text
plugins/image-analysis-pack/
  integral-package.json
  runtime-plugins/
    image-compare-viewer/
      integral-plugin.json
      renderer/
        index.html
  skills/
    image-analysis-tips/
      SKILL.md
      references/
      scripts/
      sdk/
      templates/
  scripts/
    segment_cells.py
    utils/
      image_io.py
```

## package manifest

file name:

- `integral-package.json`

最小 schema:

```json
{
  "apiVersion": "1",
  "id": "image-analysis-pack",
  "version": "0.1.0",
  "displayName": "Image Analysis Pack",
  "exports": {
    "skills": ["skills/image-analysis-tips"],
    "pythonBlocks": ["scripts/segment_cells.py:main"],
    "runtimePlugins": ["runtime-plugins/image-compare-viewer"]
  }
}
```

ルール:

- `apiVersion` は package manifest の解釈 contract version
- `version` は package 自体の配布 version
- `exports` は必須
- `exports` が無い package は invalid
- package 内 component は原則 private
- 通常 UI / scanner が見るのは `exports` に明示された component だけ
- `exports.pythonBlocks` は必ず `scripts/foo.py:function` の callable 単位で書く
- `scripts/foo.py` だけを書いて file 内 callable を全公開する省略形は持たない
- exported skill / script は package 内 helper を相対参照してよい

## runtime plugin

standalone runtime plugin は `%LocalAppData%/IntegralNotes/runtime-plugins/<pluginId>` に install する。

package 由来 runtime plugin は package 内の場所から直接読む。

```text
%LocalAppData%/IntegralNotes/packages/image-analysis-pack/runtime-plugins/image-compare-viewer/
  integral-plugin.json
```

package install 時に runtime plugin だけを `runtime-plugins/` へ materialize しない。

理由:

- package 単位の version up / uninstall / rollback が単純
- package 内 private helper を保ったまま公開 surface だけを `exports` で制御できる
- `package folder を root とする tree 型` の方針と一致する

## skill

AI skill は次を読む。

1. workspace `.codex/skills`
2. workspace `Notes/.codex/skills`
3. `%LocalAppData%/IntegralNotes/global/skills`
4. `%LocalAppData%/IntegralNotes/packages/*/exports.skills`

Codex 本体の global skill (`%UserProfile%/.codex/skills`) は IntegralNotes の LLM には渡さない。

package 内の non-exported skill は候補に出さない。

## Python script

Python は解析再現性に直結するため、実行時の source of truth は workspace 内の `.py` とする。

global / package 内 script は stock / template として扱う。

- `%LocalAppData%/IntegralNotes/global/scripts`
  - 単体 script stock
- `%LocalAppData%/IntegralNotes/packages/*/scripts`
  - package 由来 script stock

`>` picker には、package の `exports.pythonBlocks` に載った Python block も候補に出してよい。

package 由来 Python block を選択したとき、まだ workspace に import されていなければ、package stock から次をコピーしてから block を挿入する。

```text
Workspace/
  .packages/
    image-analysis-pack/
      integral-package.json
      scripts/
        segment_cells.py
        utils/
          image_io.py
```

copy 対象:

- `integral-package.json`
- `scripts/` subtree 全体

copy しないもの:

- `runtime-plugins/`
- `skills/`

note source には workspace relative path をそのまま書く。

```yaml
run: .packages/image-analysis-pack/scripts/segment_cells.py:main
```

`.packages` は system-managed path として扱い、file tree / managed file tracking の通常表示・自動登録対象から除外する。

通常 workspace `.py` scan は `.packages` 配下を除外する。例外として、`.packages/*/integral-package.json` の `exports.pythonBlocks` に載っている callable だけを Python block 候補に出す。

## import / overwrite

package 由来 Python block 選択時に `.packages/<packageId>` が未 import なら、その場で import する。

`.packages/<packageId>` が既に存在し、コピー対象と衝突する場合は自動上書きしない。ユーザー確認を出し、許可された場合だけ manifest と `scripts/` subtree を上書きする。

起動時 background scan で import 済み package scripts の欠損を検出してよい。欠損を見つけた場合も自動修復はせず、ユーザーが許可したときだけ package stock から再 import する。
