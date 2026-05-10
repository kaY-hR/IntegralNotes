# MVP 要件

## 1. 管理対象ファイル

- `cwd` 内の通常 file は、`.store/` などの system-managed path を除き managed file として扱う
- `.md` も managed file に含める
- ID prefix 自体は implementation detail とし、stable identity を持てばよい
- すべての managed file は少なくとも次の metadata を持つ
  - `id`
  - `path`
  - `hash`
  - `datatype`
  - `createdByBlockId`
- `path` は current canonical workspace relative path とする
- `hash` は current content identity とする
- metadata の物理実装は JSON file でも SQLite でもよいが、logical model は共通とする
- 起動時または Sync 時には `cwd` を scan し、未管理の workspace file を managed file として取り込めるようにする
- 自動登録では hidden path、system-managed path、既存 managed path と衝突する path は除外する
- path / hash tracking は少なくとも次を満たす
  - `path same + hash same`: 変更なし
  - `path changed + hash same`: rename / move
  - `path same + hash changed`: 内容更新
  - `path changed + hash changed`: 候補が一意なら追跡し、曖昧なら confirm

## 1.1 Workspace Template

- app は workspace 初期化用 template を同梱する
- 開発時の template source は source tree の `Notes/` とする
- packaged app の template source は `process.resourcesPath/workspace-template/` とする
- `cwd` を開いたとき、visible な通常 file / directory が無い場合は template を自動展開する
- `.git`、`.` で始まる entry、Windows hidden 属性の entry だけがある `cwd` は空扱いする
- visible な通常 file / directory がある `cwd` には自動展開しない
- workspace を開いた状態で、ユーザーが明示的に `初期化/更新` を実行できる
- 明示実行では template の同じ相対 path にある file を強制上書きする
- 同じ相対 path の directory は再帰 copy する
- MVP では削除同期、merge、user edit 検知、conflict file 生成、version 管理は行わない
- template 展開後は workspace sync 相当を走らせ、file tree / metadata を更新する
- 展開先は現在開いている workspace root 配下に限定する

## 2. Data Note

- `.md` を除く managed file と dataset に data-note を持たせる
- data-note は `.store/.integral/data-notes/{noteTargetId}.md` に置く system-managed Markdown とする
- app は data-note を file path ではなく `noteTargetId` で開く
- ユーザーは data-note の本文だけを編集できる
- data-note 対象の managed data を管理対象から外したときは、対応する metadata と data-note も削除する
- dataset の data-note 初期本文は、構成 file / folder への Markdown link 箇条書きを持つ
- 初期本文が未編集の場合、app は構成 file / folder の変化に合わせて link 箇条書きを更新してよい

## 3. Markdown Note

- `cwd` 配下の `.md` は managed file として追跡する
- `.md` managed file 自体には data-note を作らない
- frontmatter がある場合、app は frontmatter を保持し、editor / viewer には本文だけを渡す
- 保存時は本文だけを更新し、frontmatter は壊さず保持する
- `見たまま編集` と `body-only raw text` を切り替えられる

## 4. Datatype

- datatype は、解析の入出力を接続できるかを判断するための意味ラベルである
- datatype は物理的な file format そのものではなく、`extension(s)` や `.idts` 表現とは責務を分ける
- MVP の datatype は registry や別 ID を持たない任意の string とする
- output slot は生成する datatype を宣言し、生成された managed file / dataset はその datatype を metadata として持つ
- input slot は要求する datatype を宣言し、picker / validation は datatype の完全一致を強い候補として扱う
- datatype が未設定の場合は、`extension(s)` や `.idts` 表現だけで候補を出してよい
- 運用上、skill や user 定義の datatype は `{userId}/xxxx` のように namespace を付けることを推奨する
- 例:
  - `shimadzu-lc/chromatogram-json`
  - `shimadzu-lc/pca-result-bundle`
  - `demo/table-csv`
  - `{userId}/html-report`

## 5. 処理 Block

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
- `inputs` の保存値は managed file / dataset ID または `null`
- `inputs` には authoring 時に workspace relative path を書いてよいが、保存または実行前に ID へ正規化する
- `outputs` の保存値は、実行前は workspace relative path または `null`、実行後は生成された managed file / dataset ID とする
- 実行済み block は provenance として扱い、基本的に read-only 表示にする
- 再実行したい場合は、既存 block を編集して再実行するのではなく、Undo で生成済み output と参照を整理して新しい draft に戻すか、新しい block を作る
- user-facing な `itg-notes` block source は YAML のみを受け付ける
- `itg-notes` block では `use:` または `run:` の簡易記法を canonical form とする
- `run: relative/path.py:function` は内部で `plugin = "general-analysis"` とその callable block-type へ正規化する
- `outputConfigs` や `out.*.dir/name/latest` のような旧 output 設定 form は持たない
- Markdown note 保存時には、編集モードに関係なく note 全文を validate する
- 同一 note 内の `itg-notes` block で `id` が重複する場合は保存 error とする
- 同一 note 内の複数 `itg-notes` block が同じ実行済み output ID を `out:` に持つ場合は保存 error とする
- block を text でコピーして使う場合は、コピー側の `id:` を削除し、実行済み output ID を `null` または新しい出力予定 path に戻す

## 6. Slot 契約

- slot は少なくとも次を定義できる
  - `name`
  - `extension` または `extensions`
  - `datatype`
- output slot では追加で次を定義できる
  - `auto_insert_to_work_note`
  - `share_note_with_input`
  - `embed_to_shared_note`
- input slot では `extensions` によって選択可能な file suffix を表せる
- output slot では `extension` によって生成される file suffix または bundle 表現を表せる
- 非 `.idts` output slot の初期 file 名は `slot名 + "_" + 英数字3文字 + extension` とする
- `.idts` output slot の初期 folder 名は `解析表示名 + "_" + yyyyMMddHHmm + "_" + 英数字3文字` とし、既定 root は設定の `解析結果フォルダ` とする
- `datatype` は slot が意味的に要求または生成する data type を表す
- `.idts` は拡張子で bundle 表現を表すだけであり、datatype そのものではない
- `auto_insert_to_work_note` は、その output を block が置かれている作業 note へ `![]()` として自動挿入するかを表す
- `share_note_with_input` は、その output がどの input の data-note target を共有するかを表す
- `embed_to_shared_note` は、その output を共有先 data-note に provenance link と `![]()` 付きで追記するかを表す
- MVP の基本契約は `1 slot = 1 managed data reference` とする
- authoring 時の path は ID 解決のための入力であり、保存上の入力参照は ID を正とする
- 複数 file を 1 slot で扱いたい場合は `.idts` bundle を使い、その dataset ID を参照する

## 7. Bundle (`.idts`)

- `.idts` は「複数 file を束ねる optional な集合表現」とする
- `.idts` 自体は workspace 上の visible file とする
- source dataset の `.idts` は、複数 managed file / directory を束ねる manifest とする
- derived dataset の `.idts` は、解析 output folder の中に `{folder名}.idts` として作る
- derived dataset の中身は visible output folder に置き、Python にはその folder path を渡す
- `.idts` が指す中身を hidden directory に置く設計は canonical にはしない
- `.idts` manifest には少なくとも次を持てる
  - `datasetId`
  - `name`
  - `memberIds`
- `.idts` manifest には必要に応じて次を持てる
  - `dataPath`
  - `datatype`
  - `noteTargetId`
- 1 file が複数 bundle に所属できる
- `.idts` は universal な I/O 単位ではなく、bundle が必要な場合にだけ使う
- `.idts` を開いたときは dedicated viewer ではなく、その dataset の data-note を表示する

## 8. Python 汎用解析

- `general-analysis` plugin を用意する
- `general-analysis` plugin は `cwd` 配下の `.py` を走査し、decorator 付き関数を block-type 候補として動的生成する
- Python callable の canonical ID は `relative/path.py:function` とする
- `block-type` はその canonical callable string を使う
- Python block の `params` 契約は `@integral_block(..., params={...})` の Python literal JSON Schema subset を正とする
- `params` schema が無い callable では有効な param は空とし、YAML 側の `params:` は削除してよい
- MVP の `params` schema は root `type: object` と `properties` を扱う
- MVP の property type は `string / number / integer / boolean` と `enum` に限る
- MVP の property metadata は `title / description / default / minimum / maximum` を扱う
- `default` が無い property の初期値は `null` とし、`required` は MVP では扱わない
- YAML 側の schema 外 param、未対応型 param は保存・フォーム反映・実行前正規化で削除してよい

## 9. Python Callable Discovery

- ユーザー管理の `.py` file 自体を source of truth とする
- app は decorator 付き関数から `displayName`, `description`, `inputSlots`, `outputSlots` を読む
- slot 定義は string shorthand でも object form でもよい
- object form の canonical 例:

```python
@integral_block(
    display_name="PCA",
    description="CSV から PCA を計算する",
    inputs=[
        {"name": "samples", "extensions": [".csv"], "datatype": "demo/table-csv"}
    ],
    outputs=[
        {"name": "score", "extension": ".csv", "datatype": "demo/pca-score-table"},
        {
            "name": "report",
            "extension": ".html",
            "datatype": "demo/pca-report-html",
            "auto_insert_to_work_note": True,
            "share_note_with_input": "samples",
            "embed_to_shared_note": True,
        },
    ],
    params={
        "type": "object",
        "properties": {
            "n_components": {
                "type": "integer",
                "title": "主成分数",
                "description": "計算する主成分の数",
                "default": 2,
                "minimum": 1,
            },
            "scale": {
                "type": "boolean",
                "title": "標準化",
                "default": True,
            },
            "method": {
                "type": "string",
                "title": "手法",
                "enum": ["pca", "kernel-pca"],
                "default": "pca",
            },
        },
    },
)
```

- editor 上で `>` を入力すると Python callable 候補 popup を表示できる
- 候補一覧では `displayName` を主表示し、`relative/path.py:function` を補助表示する
- 候補選択時には `run:` を持つ YAML `itg-notes` block を note へ挿入する
- package 由来 callable を選択した場合は、package の `integral-package.json` と `scripts/` subtree を workspace の `.packages/{packageId}/` へ copy してから、`.packages/{packageId}/scripts/foo.py:function` を note へ挿入する
- `.packages` は system-managed path として file tree / managed file tracking の通常表示・自動登録対象から除外する
- MVP の scan 契約は `@integral_block(...)` の直後に `def ...(` が続く形とする
- app は decorator の `params` schema から block 上の param 編集フォームを生成する
- param 編集フォームは YAML の `params:` を更新する補助 UI であり、source of truth は正規化済みの `itg-notes` YAML と decorator schema の組み合わせとする

## 10. Python 実行

- 実行時には `analysis-args.json` を生成する
- app は `inputs` の ID を current path へ解決する
- app は実行前 `outputs` の path を出力先として確定する
- `inputs / outputs` には Python がそのまま使える絶対 path を渡す
- 非 `.idts` input は、ID から解決した current file path を渡す
- `.idts` input は `.idts` manifest file path を渡す
- Python script は SDK helper (`resolve_dataset_files` / `resolve_dataset_input`) を使って dataset の member files や readable folder を得る
- source dataset は必要に応じて SDK helper が staging folder を materialize してよい
- 非 `.idts` output は、指定された output file path をそのまま渡す
- `.idts` output は、指定された output folder を app 側で事前に確保し、Python にはその folder path を渡す
- `.idts` output の実行成功後、app は output folder 内に `{folder名}.idts` manifest を作成する
- `.idts` output の `out:` は実行前は output folder path、実行後は生成された dataset ID とする
- `params` は decorator schema に沿って正規化した note source の object を渡す
- decorator schema に無い param、未対応型 param、schema 外 key は Python 実行 payload から削除する
- runner は `analysis-args.json` を読んで target callable を `inputs`, `outputs`, `params` 引数で呼び出す
- 成功/失敗判定は exit code のみで行う
- exit code が非 0 の場合、note 上の実行結果には Python の `stderr` / `stdout` / runner error message を優先して表示する
- exit code が 0 の場合でも、宣言された output path が作成されていなければ app 側の実行エラーとして note 上に表示する
- 実行成功後は output path に対応する managed file metadata、または output folder に対応する dataset metadata を作成または更新する
- 実行失敗時の詳細 error text は選択・コピー可能な表示にする
- 実行失敗時は、対象 `itg-notes` block 直下へ `integral-error` fenced code block として error text を反映してよい
- 実行成功後は `out:` の値を生成された managed file / dataset ID へ書き換える
- 実行済み block の UI は read-only とし、Delete と Undo を可能にする
- Undo は生成済み managed output の file / dataset folder、metadata、data-note、Markdown link / embed 参照を整理し、同じ block 定義から新しい block ID / 初期 input / 初期 params / 新しい output path を持つ draft を作り直す
- output slot が `auto_insert_to_work_note = true` を持つ場合、app はその output を block 直下へ `![]()` として追記してよい
- output slot が `share_note_with_input` を持つ場合、app は output の note target を指定 input の note target に合わせる
- output slot が `embed_to_shared_note = true` を持つ場合、app は共有先 data-note へ provenance link と `![]()` を追記してよい
- note への自動反映は append-only とし、古い embed の整理は app ではなくユーザー操作に委ねてよい
- generated file が持つべき最低限の情報は `createdByBlockId` と `datatype` でよい
- 実行時の current working directory は workspace root を基本とする
- `analysis-args.json` や log は `.store/.integral/runtime/` 配下へ置いてよい

## 11. 標準表示

- `htm / html`
- `bmp / gif / jpg / jpeg / png / svg / webp`
- `bat / c / css / csv / env / ini / js / json / log / md / mjs / ps1 / py / sh / sql / toml / ts / tsx / tsv / txt / xml / yaml / yml`
- `.idts`

を標準表示対象とする。

- 表示対象 file は拡張子で自動判定する
- 拡張子未登録でも text と読める file は text viewer で扱ってよい
- `.idts` は対応する data-note を表示する

## 12. 装置 Plugin

- 装置 plugin も共通 block schema を使う
- 必要なら custom UI を持てる
- 装置 plugin も ID-backed slot 契約を使う
- authoring 補助として path 入力を許可する場合も、保存時または実行前に managed data ID へ正規化する

## 13. Tracking と参照更新

- managed file の identity は path ではなく ID と hash で追う
- path 変更を追跡できた場合、app は参照元 text file を scan して old path を new path へ書き換えてよい
- 少なくとも Markdown link / image と block source の path 参照は更新対象に含める
- `path -> id` は current lookup index として持てるが、identity の source of truth ではない

## 14. ノート内 Link / Image

- 通常 note 本文では標準 Markdown link `[label](target)` を使って workspace 内 file へ link できる
- 通常 note 本文では標準 Markdown image 記法 `![alt](target)` を使って画像や workspace file を埋め込める
- block provenance のため、`[label](/path/to/note.md#BLK-1F8E2D0A)` のような `path + block id` link を許容してよい
- 記法自体は path ベースのままとし、ID 記法にはしない
- 外部 rename / move を追跡できた場合も、app は path 記法の source を更新する

## 15. GC

- block 実行で作られる runtime log や source dataset materialize 用 staging folder は GC 対象にできる
- user-facing workspace file 自体は app が勝手に消さない
- 再実行で不要になった旧 bundle は、どこからも参照されなければ GC 対象にできる

## 16. AI Chat CLI tool

- AI Chat panel と inline AI は、共通の host command tool を使って workspace 上で PowerShell command を実行できる
- tool 名は user-facing には CLI / shell command と表現してよいが、MVP の実体は PowerShell 互換 shell とする
- tool_call の入力は少なくとも `command` と `purpose` を必須にする
- `workingDirectory` は optional とし、指定する場合も開いている workspace folder からの相対 path に限定する
- shell executable path は AI Chat settings で指定できる
- shell executable path が未設定の場合は `pwsh` を優先し、見つからなければ Windows PowerShell に fallback する
- PowerShell 起動時は `-NoProfile -NonInteractive` を付け、ユーザー profile に依存しない実行にする
- `stdin` は MVP では未対応とする
- tool_call が来たら app は実行前に command / purpose / workingDirectory / timeout / warning を dialog 表示する
- command は dialog 上で編集できる
- user が編集して許可した場合、LLM へ返す tool result には編集後 command を含める
- user が編集していない場合、LLM へ返す tool result には編集後 command を省略する
- user はメッセージ付きで reject でき、reject 理由は LLM へ tool result として返す
- MVP では毎回承認を必須にし、session remembered allow は持たない
- 将来は workspace 配下の allow / deny JSON を読み、Claude / Codex 系の permission schema に寄せる
- 危険そうな command、workspace 外へのアクセスが疑われる command、network / install 系 command は強い警告を出す
- 警告が出た場合も、user が明示許可すれば実行できる
- 実行時の default timeout は 60 秒とする
- LLM は必要に応じて timeout を指定できる
- timeout 上限は 300 秒とし、それを超える指定は 300 秒へ丸める
- timeout 超過時はプロセス停止を試み、LLM へ `status: "timeout"` と partial stdout / stderr を返す
- 実行中は可能なら stdout / stderr を dialog にリアルタイム表示する
- 実行中は user が Cancel できる
- Cancel 時はプロセス停止を試み、LLM へ `status: "cancelled"` と partial stdout / stderr を返す
- LLM へ返す stdout / stderr はそれぞれ最大 20,000 文字に切り詰める
- AI Chat panel と inline AI popup は、assistant text を生成中に live streaming 表示する
- tool loop の途中で tool 実行が完了した場合、UI は可能な範囲で live tool trace を表示する
- chat transcript には purpose / 承認・拒否・編集有無 / 実行 command / exit code / truncated output summary を残す
- 実行後は成功/失敗/timeout/cancel に関係なく workspace sync 相当を走らせる
- この機能は実行前確認と workspace 起点の実行を提供するものであり、Python script 内の任意 file access などを完全に sandbox するものではない
- AI の Markdown commit tool は、挿入後の note 全文を保存時と同じ validator に通す
- AI の Markdown commit tool は、Markdown source 上の挿入位置と現在の note Markdown から candidate Markdown を作り、validate error を tool result として AI に返す
- renderer は AI Markdown 挿入の最終反映前にも、実際の editor transaction 後 Markdown を同じ validator に通す。ただしこれは最終防衛線であり、通常の validation error は AI tool result として返す
- validate error がある場合、AI commit は note に反映せず、validation error を tool result として LLM に返す
- AI の `writeWorkspaceFile` が `.md` file を保存する場合も同じ validator に通し、validate error がある場合は保存しない
- AI が validation error を受け取ったまま成功 commit せず終了した場合、UI は通常の完了扱いにせず、popup を閉じずに会話履歴と tool trace を残す
- Inline Action の terminal tool は、tool call された時点ではなく成功した時点で agent loop を停止する
