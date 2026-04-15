# MVP 要件

## 1. 管理対象データ

- `original data` と `dataset` はどちらも managed data として扱う
- original data には一意 ID `ORD-...`、dataset には一意 ID `DTS-...` を付与する
- すべての managed data は `.store/.integral/{id}.json` metadata を持つ
- metadata には少なくとも `id`, `path`, `hash`, `representation`, `visibility`, `provenance`, `createdAt` を持たせる
- `path` は current canonical workspace relative path とし、workspace 内のどこでもよい
- hidden 管理したい data の `path` は `.store/` 配下でもよい
- `Data/` は visible path の default に過ぎず、固定の canonical location ではない
- `file` は content hash、`directory` は tree hash、`dataset-json` は manifest content hash で追跡する
- 起動時には `path` / `hash` の差分から rename / move / content update を検知する
- 検知規則は少なくとも次を満たす
  - `path same + hash same`: 変更なし
  - `path changed + hash same`: rename / move とみなす
  - `path same + hash changed`: 内容更新とみなす
  - `path changed + hash changed`: 候補が一意なら追跡し、曖昧なら confirm する

## 2. original data

- ユーザーは `cwd` 内外のファイルまたはフォルダを `original data` として登録できる
- original data の `representation` は `file` または `directory`
- `cwd` 外から登録した場合、app は workspace 内の default visible path へ copy してよい
- `cwd` 内の対象を登録した場合、元の path をそのまま canonical path としてよい
- hidden 管理したい場合、app は `.store/` 配下 path を canonical path にしてよい
- user-facing な visible copy / mirror が必要な場合は
  - file は hard link
  - directory は junction
  を使ってよい

## 3. data-note

- `1 managed data = 1 data-note` を基本とする
- data-note は ID に 1:1 で紐づく system-managed Markdown とする
- data-note の保存場所は `.store/.integral/data-notes/{id}.md` とする
- data-note は workspace 上の user-managed file ではない
- ユーザーは data-note の本文だけを編集できる
- ユーザーによる rename / move は許可しない
- app は data-note を file path ではなく target ID で開く
- data-note は「この data は何か」を説明する note であり、canonical file link 一覧の自動生成は必須要件にしない
- `data-note` に限らず、`cwd` 配下の通常 Markdown は frontmatter があれば app が保持し、editor / viewer には本文だけを渡す
- Markdown 保存時は本文だけを更新し、既存 frontmatter は壊さず保持する
- Markdown note tab では `見たまま編集` と `body-only raw text` を切り替えられる
- mode 切替は tab 内右上の button から行う
- raw text mode でも frontmatter は表示せず、両 mode は同じ本文 string を共有する

## 4. 処理 block

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

## 5. 処理入出力と dataset 解決

- 内部契約は `1 input slot = 1 dataset`
- 内部契約は `1 output slot = 1 dataset`
- dataset は `name` を持つ
- dataset の `representation` は少なくとも `directory` または `dataset-json` を表現できる
- `dataset-json` には member となる `originalDataId[]` を保持できる
- GUI 上だけ、`1 input slot = N original data items` を許容する
- `N original data items` を選んだ場合、app は source dataset を新規作成する
- source dataset の current path は visible でも hidden でもよい
- block 内部の参照は常に `datasetId` で行う
- 実行や表示で file system access が必要な場合、app は `datasetId` を「読める directory path」へ resolve する
- `directory` dataset は current path をそのまま使ってよい
- `dataset-json` は実行時に staging directory へ resolve してよい
- output dataset 作成時は対応する data-note も自動生成または更新する
- output dataset の system 既定名には ID を使ってよい

## 6. Python 汎用解析

- `general-analysis` plugin を用意する
- `general-analysis` plugin は `cwd/.py-scripts/` を走査して block-type を動的生成する
- 各 script 資産は `PYS-...` ID を持つ
- `block-type` はそのまま `PYS-...` を使う
- Python block の `params` は MVP では常に `{}` とする

## 7. Python script 登録

- ユーザーは任意の `.py` を選んで script 資産として登録できる
- 登録時に entry file を選ぶ
- 登録時に同梱するファイルを選ぶ
- 同階層の `.py` は自動同梱する
- それ以外のファイルは手動で同梱する
- 登録時に input slot 名を決める
- 登録時に output slot 名を決める
- 登録結果は `.py-scripts/PYS-.../` に保存する

## 8. Python 実行

- 実行時には `analysis-args.json` を生成する
- `inputs / outputs` には datasetId を resolve した絶対パスを渡す
- output dataset フォルダは app 側で事前作成する
- Python スクリプトは output dataset フォルダへ自由に書き込める
- 成功/失敗判定は exit code のみで行う
- output dataset が空でも「空の結果」として扱う
- output dataset の current path は hidden `.store/` 配下を default にしてよい
- output dataset 作成時は対応する data-note も自動生成または更新する

## 9. kind / format

- dataset metadata は `kind` を持つ
- source dataset の `kind` は `source-bundle`
- derived dataset の `kind` は、plugin/script が明示しない限り `block-type.slotName`
- slot 定義は `acceptedKinds` / `producedKind` を表現できる
- ただし MVP では enforcement しない

## 10. 標準表示

- `html`
- `png / jpg / jpeg / svg`
- `txt / md / json / csv`

を標準表示対象とする。

- 表示対象ファイルは拡張子で自動判定する
- renderable ファイルが複数ある場合は、すべて flex-layout で表示する

## 11. 可視化 plugin

- 可視化 plugin は、非閲覧データを renderable ファイルへ変換する処理 plugin とする
- 「結果を出してその場で表示する」責務は処理 block に直接持たせない
- 結果を見たい場合は、標準表示 block または可視化 block を別に置く

## 12. 装置 plugin

- 装置 plugin も共通 block schema を使う
- 必要なら custom UI を持てる
- 装置 plugin も dataset を input に取り、dataset を output にできる

## 13. Provenance と tracking

- すべての dataset は `.store/.integral/{datasetId}.json` を持つ
- dataset metadata には `name` を持たせる
- derived dataset には `createdByBlockId` を持たせる
- source dataset では `createdByBlockId` は `null` でよい
- `dataset-json` では provenance 用に `memberIds` を metadata または manifest に持たせる
- path / hash tracking の基盤は original data / dataset の両方で共通にする

## 14. GC

- block 実行で作られる output dataset は immutable とする
- 再実行時は新しい output dataset を作る
- block の `outputs` は最新 dataset へ更新する
- どこからも参照されない古い dataset は GC 対象にする

## 15. ノート内リンク

- `cwd` 配下の Markdown では、frontmatter があっても link / image 補完・open・rename 追従は本文だけを対象にする
- 通常 note 本文では標準 Markdown link `[label](target)` を使って workspace 内 file へ link できる
- app が補完で自動挿入する canonical form は `[label](/path/from/cwd)` とする
- app は `/path/from/cwd` と `path/from/cwd` の両方を workspace root 基準で解決する
- link target は `cwd` 配下の file とし、directory は MVP 対象外とする
- data-note は system-managed であり、通常 note の link 補完対象には含めない
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
- heading link 補完と外部変更追従は MVP 対象外とする
- 詳細は `docs/30_設計/60_ノートリンク記法.md` を参照

## 16. ノート画像添付

- 通常 note 本文では標準 Markdown image 記法 `![alt](target)` を使って画像を埋め込める
- note editor 上で image insert / paste / drop した画像は workspace file として永続化する
- app が自動挿入する canonical form は `![](/Data/yyyyMMdd-HHmm-RRR.ext)` とする
- 既定保存先は `Data/` 配下とし、file 名は時刻 + 3 桁 random + 拡張子で決める
- saved markdown に `blob:` URL や一時 object URL を残さない
- editor 表示時は workspace path を DOM 用 URL へ変換し、再オープン後も表示できる
- 読み取り時は `/path/from/cwd` と `path/from/cwd` の両方を受ける
- 自動保存先は `Data/` だが、手書き image link は workspace 内の他 path も許容する
- IntegralNotes 内の rename / move では、`cwd` 配下の `.md` を走査して image target も自動更新する
- explorer 上での画像貼り付け、保存先設定 UI、非 image attachment は MVP 対象外とする
- 詳細は `docs/30_設計/70_ノート画像添付.md` を参照

