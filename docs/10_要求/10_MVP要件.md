# MVP 要件

## 1. 管理対象データ

- `original data` と `dataset` はどちらも managed data として扱う
- original data には一意 ID `ORD-...`、dataset には一意 ID `DTS-...` を付与する
- すべての managed data は `.store/.integral/{id}.json` metadata を持つ
- metadata には少なくとも `id`, `path`, `hash`, `representation`, `visibility`, `provenance`, `createdAt` を持たせる
- `path` は current canonical workspace relative path とし、workspace 内のどこでもよい
- `visibility` はその `path` を app が hidden 扱いするかどうかの属性であり、hidden canonical copy の存在を意味しない
- hidden 判定は path segment ベースとし、親 directory のいずれか、または directory 自身が `.` または `_` で始まる場合は hidden とする
- file 自体は `.` 始まりだけを hidden とし、`_` 始まり file は hidden としない
- `Data/` は visible path の default に過ぎず、固定の canonical location ではない
- `file` は content hash、`directory` は tree hash、`dataset-json` は manifest content hash で追跡する
- dataset metadata の `path` は `.idts` manifest の path を指す
- 起動時には `path` / `hash` の差分から rename / move / content update を検知する
- 起動時または Sync 時には `cwd` を scan し、`.md` 以外かつ未管理の workspace file があれば `ORD-...` を発行して original data として自動登録する
- 自動登録では hidden directory 配下、hidden file、system-managed directory 配下、既存 managed path と衝突する path は除外する
- `path` / `hash` のいずれでも追跡できない managed data は confirm を出したうえで管理対象から外せるようにする
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
- original data の canonical 実体を `.store/objects` に退避し、visible 側を mirror / alias にする構成は採らない
- data-note や dataset materialize は original data の current path を正として参照する

## 3. data-note

- `1 managed data = 1 data-note` を基本とする
- data-note は ID に 1:1 で紐づく system-managed Markdown とする
- data-note の保存場所は `.store/.integral/data-notes/{id}.md` とする
- data-note は workspace 上の user-managed file ではない
- ユーザーは data-note の本文だけを編集できる
- ユーザーによる rename / move は許可しない
- app は data-note を file path ではなく target ID で開く
- data-note は「この data は何か」を説明する note であり、canonical file link 一覧の自動生成は必須要件にしない
- managed data を管理対象から外したときは、対応する metadata JSON と data-note も同時に削除する
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
- user-facing な `itg-notes` block source は YAML のみを受け付ける
- `itg-notes` block では `use:` または `run:` の簡易記法を canonical form とする
- `run: relative/path.py:function` は内部で `plugin = "general-analysis"` とその callable block-type へ正規化する
- note source 上の input 参照は `.idts` path を優先し、app が内部で `datasetId` へ解決する

## 5. 処理入出力と dataset 解決

- 内部契約は `1 input slot = 1 dataset`
- 内部契約は `1 output slot = 1 dataset`
- dataset は `name` を持つ
- dataset の `representation` は `dataset-json` とする
- source / derived を問わず dataset の canonical entrypoint は `.idts` manifest に統一する
- `dataset-json` には `memberIds` や `dataPath` など、directory 解決に必要な情報を保持できる
- GUI 上の dataset 一覧や picker、viewer では `name` を主表示し、ID は通常表示しない
- GUI 上だけ、`1 input slot = N original data items` を許容する
- `N original data items` を選んだ場合、app は source dataset を新規作成する
- source dataset の current path は visible path を default にしてよい
- derived dataset の current path も visible `Data/{dataset-name}.idts` を default にしてよい
- Python 実行 block の slot UI は `Inputs` / `Outputs` の section に分ける
- output slot ごとに、保存先 folder と dataset 名を事前指定できる
- output slot の folder 指定 UI は relative path 表示つきの folder picker とする
- output slot の dataset 名入力は textarea とし、既定値は slot 名にする
- output slot の既定保存先 folder は `/Data/` とする
- block 内部の参照は常に `datasetId` で行う
- 実行や表示で file system access が必要な場合、app は `datasetId` を「読める directory path」へ resolve する
- app は `.idts` manifest を読んで source / derived の差を意識せず resolve できるようにする
- output dataset 作成時は対応する data-note も自動生成または更新する
- output dataset の file 名は user 指定の dataset 名を優先し、衝突時のみ `_1`, `_2`, ... を付与する

## 6. Python 汎用解析

- `general-analysis` plugin を用意する
- `general-analysis` plugin は `cwd` 配下の `.py` を走査し、decorator 付き関数を block-type 候補として動的生成する
- Python callable の canonical ID は `relative/path.py:function` とする
- `block-type` はその canonical callable string を使う
- Python block の `params` は free-form object とし、schema enforcement はしない

## 7. Python callable discovery

- ユーザー管理の `.py` file 自体を source of truth とする
- app は decorator 付き関数から `displayName`, `description`, `inputSlots`, `outputSlots` を読む
- editor 上で `>` を入力すると Python callable 候補 popup を表示できる
- 候補一覧では `displayName` を主表示し、`relative/path.py:function` を補助表示する
- 候補選択時には `run:` を持つ YAML `itg-notes` block を note へ挿入する
- `.py` file や補助 file を app 側の専用ディレクトリへ copy しない
- MVP の scan 契約は `@integral_block(...)` の直後に `def ...(` が続く形とする

## 8. Python 実行

- 実行時には `analysis-args.json` を生成する
- `inputs / outputs` には datasetId を resolve した絶対パスを渡す
- `params` は note source から読んだ object をそのまま渡す
- runner は `analysis-args.json` を読んで target callable を `inputs`, `outputs`, `params` 引数で呼び出す
- output dataset フォルダは app 側で事前作成する
- Python callable は output dataset フォルダへ自由に書き込める
- 成功/失敗判定は exit code のみで行う
- output dataset が空でも「空の結果」として扱う
- output dataset の current path は visible `Data/{dataset-name}.idts` を default にしてよい
- output dataset 作成時は対応する data-note も自動生成または更新する
- 実行時の current working directory は workspace root を基本とする
- `analysis-args.json` や log は `.store/.integral/runtime/` 配下へ置いてよい

## 9. kind / format

- dataset metadata は `kind` を持つ
- source dataset の `kind` は `source-bundle`
- derived dataset の `kind` は、plugin/script が明示しない限り `block-type.slotName`
- slot 定義は `acceptedKinds` / `producedKind` を表現できる
- ただし MVP では enforcement しない

## 10. 標準表示

- `htm / html`
- `bmp / gif / jpg / jpeg / png / svg / webp`
- `bat / c / css / csv / env / ini / js / json / log / md / mjs / ps1 / py / sh / sql / toml / ts / tsx / tsv / txt / xml / yaml / yml`
- `.idts`

を標準表示対象とする。

- 表示対象ファイルは拡張子で自動判定する
- 拡張子未登録でも text と読める file は text viewer で扱ってよい
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
- `dataset-json` では provenance / resolve 用に `memberIds` や `dataPath` を metadata または manifest に持たせる
- path / hash tracking の基盤は original data / dataset の両方で共通にする
- source dataset の `memberIds` に含まれる original data が管理対象から外れた場合は、対応する `.idts` manifest からもその ID を除去して metadata を再同期する

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
- explorer 上の貼り付けは note image attach とは別機能として扱う
- note image attach では保存先設定 UI と非 image attachment は MVP 対象外とする
- 詳細は `docs/30_設計/70_ノート画像添付.md` を参照

## 17. ノート内埋め込み preview

- 通常 note 本文では標準 Markdown image 記法 `![](/path/from/cwd)` を、画像添付だけでなく workspace file の埋め込み preview にも使える
- app は `/path/from/cwd` と `path/from/cwd` の両方を workspace root 基準で解決する
- `.idts` embed は dataset renderable preview を使う
- それ以外の file の embed 解決順は `plugin viewer -> built-in viewer -> unsupported` とする
- `html / svg / text / markdown / plugin viewer` などの embed preview は read-only としつつ、preview 内では通常どおりスクロールや選択ができるようにする
- 埋め込み中の open 導線は surface 全体 click ではなく、右上の flat な `[別タブで開く]` button に分離する
- `[別タブで開く]` は workspace file なら通常の file tab、managed data note fallback なら対応する note tab を開く
- resize handle による縦方向リサイズは維持してよい
- 詳細は `docs/30_設計/40_標準描画と結果閲覧.md` を参照

## 18. Explorer tree 操作

- Explorer では単一選択に加え、`Ctrl/Cmd` による加算選択を許容する
- Explorer では `Shift` による可視 tree 順の範囲選択を許容する
- `Ctrl/Cmd + Shift` では既存選択へ範囲追加できてよい
- Explorer 内 drag and drop では、通常 drag-drop は move、`Ctrl/Cmd + drag` は copy とする
- 外部 OS からの file / directory drop は copy として workspace へ取り込める
- `Ctrl/Cmd + V` および右クリック `貼り付け` では、app 内で copy した workspace 項目を貼り付けられる
- `Ctrl/Cmd + V` および右クリック `貼り付け` では、外部アプリが clipboard に置いた file / directory を取り込める
- Explorer 上の clipboard image 貼り付けは許容し、既定 file 名は `image.png` とする
- 貼り付け先は選択中 directory、file 選択時はその親 directory、未選択時は workspace root とする
- 右クリックメニューから `コピー / 貼り付け / 削除 / 名前を変更 / パスのコピー / 相対パスのコピー / DataSetに追加` を実行できる

