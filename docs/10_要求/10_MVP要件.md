# MVP 要件

## 1. データ登録

- ユーザーは `cwd` 内外のファイルまたはフォルダを `original data` として登録できる
- original data には一意 ID `ORD-...` を付与する
- `1 original data = 1 data note` を基本とする
- data note はユーザーがノート上で参照できる
- original data / dataset の data note metadata は frontmatter に持たせ、editor / viewer には本文だけを渡す
- `data-note` に限らず、`cwd` 配下の Markdown は frontmatter があれば app が保持し、editor / viewer には本文だけを渡す
- Markdown 保存時は本文だけを更新し、既存 frontmatter は壊さず保持する
- original data の data note file 名は原則 `originalName.md` とする
- data note file 名が重複する場合は保存前に連番を付けて解消する
- canonical 実体は `.store/` に置く
- metadata は `.store/.integral/{originalDataId}.json` に置く
- file original data の実体は `.store/{originalDataId}{ext}` に置く
- directory original data の実体は `.store/{originalDataId}/` に置く
- `cwd` 外から登録する場合は canonical 実体を `.store` にコピーし、`Data/` に alias を置く
- すでに `cwd` 内にある対象を登録する場合は、canonical 化後も元の path を alias として残す
- metadata には visible alias 用に `aliasRelativePath` を持たせる
- user-facing な path は
  - file は hard link
  - directory は junction
 で alias を残せるようにする

## 2. 処理 block

すべての block は次の共通キーを持つ。

- `id`
- `plugin`
- `block-type`
- `params`
- `inputs`
- `outputs`

補足:

- `id` は `BLK-...`
- app は `id` がなければ自動補完する
- `inputs / outputs` は slot 名を key に持つ
- `inputs / outputs` の値は `datasetId` または `null`

## 3. 処理入出力

- 内部契約は `1 input slot = 1 dataset`
- 内部契約は `1 output slot = 1 dataset`
- dataset は `name` を持つ
- ユーザーが明示的に作る source dataset では `name` 入力を要求する
- system が内部的に作る dataset では `name` に ID を使ってよい
- GUI 上だけ、`1 input slot = N original data items` を許容する
- `N original data items` を選んだ場合、app は source dataset を新規作成する
- source dataset の実体も `.store/{datasetId}/` に materialize する
- source dataset 作成時は対応する data note も `data-catalog/` に自動生成する
- source dataset の data note file 名は dataset 名を使う
- source dataset 内では custom manifest を置かず、普通の file / directory 群として見えるようにする
- source dataset 作成時は
  - file original data は hard link
  - directory original data は junction
  を使う

## 4. Python 汎用解析

- `general-analysis` plugin を用意する
- `general-analysis` plugin は `cwd/.py-scripts/` を走査して block-type を動的生成する
- 各 script 資産は `PYS-...` ID を持つ
- `block-type` はそのまま `PYS-...` を使う
- Python block の `params` は MVP では常に `{}` とする

## 5. Python script 登録

- ユーザーは任意の `.py` を選んで script 資産として登録できる
- 登録時に entry file を選ぶ
- 登録時に同梱するファイルを選ぶ
- 同階層の `.py` は自動同梱する
- それ以外のファイルは手動で同梱する
- 登録時に input slot 名を決める
- 登録時に output slot 名を決める
- 登録結果は `.py-scripts/PYS-.../` に保存する

## 6. Python 実行

- 実行時には `analysis-args.json` を生成する
- `inputs / outputs` には dataset フォルダの絶対パスを渡す
- output dataset フォルダは app 側で事前作成する
- Python スクリプトは output dataset フォルダへ自由に書き込める
- 成功/失敗判定は exit code のみで行う
- output dataset が空でも「空の結果」として扱う
- dataset フォルダの実体は `.store/{datasetId}/` を正とする
- output dataset 作成時は対応する data note も `data-catalog/` に自動生成する
- output dataset の data note file 名も dataset 名を使い、system 既定名は ID でよい

## 7. kind / format

- dataset は `dataset.json.kind` を持つ
- source dataset の `kind` は `source-bundle`
- derived dataset の `kind` は、plugin/script が明示しない限り `block-type.slotName`
- slot 定義は `acceptedKinds` / `producedKind` を表現できる
- ただし MVP では enforcement しない

## 8. 標準表示

- `html`
- `png / jpg / jpeg / svg`
- `txt / md / json / csv`

を標準表示対象とする。

- 表示対象ファイルは拡張子で自動判定する
- renderable ファイルが複数ある場合は、すべて flex-layout で表示する

## 9. 可視化 plugin

- 可視化 plugin は、非閲覧データを renderable ファイルへ変換する処理 plugin とする
- 「結果を出してその場で表示する」責務は処理 block に直接持たせない
- 結果を見たい場合は、標準表示 block または可視化 block を別に置く

## 10. 装置 plugin

- 装置 plugin も共通 block schema を使う
- 必要なら custom UI を持てる
- 装置 plugin も dataset を input に取り、dataset を output にできる

## 11. Provenance

- すべての dataset は `.store/.integral/{datasetId}.json` を持つ
- dataset metadata には `name` を持たせる
- derived dataset には `createdByBlockId` を持たせる
- source dataset では `createdByBlockId` は `null` でよい
- source dataset では provenance 用に source member 情報を metadata に持たせる

## 12. GC

- dataset は immutable
- 再実行時は新しい output dataset を作る
- block の `outputs` は最新 dataset へ更新する
- どこからも参照されない古い dataset は GC 対象にする

## 13. ノート内リンク

- `cwd` 配下の Markdown では、frontmatter があっても link / image 補完・open・rename 追従は本文だけを対象にする
- 通常 note 本文では標準 Markdown link `[label](target)` を使って workspace 内 file へ link できる
- app が補完で自動挿入する canonical form は `[label](/path/from/cwd)` とする
- app は `/path/from/cwd` と `path/from/cwd` の両方を workspace root 基準で解決する
- link target は `cwd` 配下の file とし、directory は MVP 対象外とする
- Milkdown では `[` を打った時点で `cwd` 配下 file 候補を表示できる
- 候補一覧は file 名を主表示、path を補足表示とする
- 候補選択時の label は
  - `.md` は拡張子なし
  - それ以外は拡張子あり
  とする
- link click 時は既存の workspace file open 経路を使う
  - `.md` は app 内 tab
  - renderable / text は app 内 viewer
  - unsupported は外部アプリ
- IntegralNotes 内の rename / move では、`cwd` 配下の `.md` を走査して link target を自動更新する
- heading link 補完、`data-note -> canonical data` link、外部変更追従は MVP 対象外とする
- 詳細は `docs/30_設計/60_ノートリンク記法.md` を参照

## 14. ノート画像添付

- 通常 note 本文では標準 Markdown image 記法 `![alt](target)` を使って画像を埋め込める
- note editor 上で image insert / paste / drop した画像は workspace file として永続化する
- app が自動挿入する canonical form は `![](/Data/yyyyMMdd-HHmm-RRR.ext)` とする
- 保存先は `Data/` 配下とし、file 名は時刻 + 3 桁 random + 拡張子で決める
- saved markdown に `blob:` URL や一時 object URL を残さない
- editor 表示時は workspace path を DOM 用 URL へ変換し、再オープン後も表示できる
- 読み取り時は `/path/from/cwd` と `path/from/cwd` の両方を受ける
- 自動保存先は `Data/` だが、手書き image link は workspace 内の他 path も許容する
- IntegralNotes 内の rename / move では、`cwd` 配下の `.md` を走査して image target も自動更新する
- explorer 上での画像貼り付け、保存先設定 UI、非 image attachment は MVP 対象外とする
- 詳細は `docs/30_設計/70_ノート画像添付.md` を参照

