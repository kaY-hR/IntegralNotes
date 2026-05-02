# Inline Action 設計

## 目的

Inline Action は、Markdown editor のカーソル位置から AI による補助動作を起動する仕組みである。

従来の `??` / `>>` / `@@` は個別実装に近かったが、今後は共通の Inline Action registry に寄せる。

Inline Action は LLM の skill とは別概念である。

- Inline Action: editor 上で何を起動し、どのように note へ反映するかを決める
- Skill: 会話や実行に専門的な手順・知識を追加する

MVP では skill 連携および `$$` trigger は扱わない。

## 用語

- Inline Action
  - `@@write` など、editor 内で呼び出す AI action
- Action picker
  - `@@` 入力時に表示する Inline Action 選択 popup
- User prompt
  - action 選択後に popup 内でユーザーが入力する指示
- Commit
  - AI 実行結果を editor の cursor 位置へ確定反映すること
- Helper tool
  - note を変更せず、AI に draft や workspace 情報を返す tool

## Trigger

### `@@`

`@@` を単独で入力した場合、Inline Action picker を表示する。

picker では標準 action とユーザー定義 action を一覧表示する。

action 選択後の挙動は、その action の `promptRequired` に従う。

- `promptRequired: true`: user prompt popup を表示する
- `promptRequired: false`: user prompt なしで即実行する

### `@@name`

`@@write` のように action 名が続く場合、該当 action を直接起動する。

存在しない action 名の場合は、エラー表示または picker への fallback を行う。

### `??`

`??` は新仕様では `@@continue` の alias とする。

旧仕様では `??` は prompt あり Markdown 挿入の入口だったが、新仕様では「任せる」「文脈から自動で続ける」短縮入力として再定義する。

### `>>`

`>>` は `@@mkpy` の alias とする。

picker は出さず、`@@mkpy` の user prompt popup を直接表示する。

## 標準 Inline Action

### `@@continue`

文脈から自動で次に必要な内容を推定し、cursor 位置へ反映する。

- promptRequired: `false`
- readScope: `current-document-and-selected-files`
- canInsertMarkdown: `true`
- canEditWorkspaceFiles: `true`
- canRunShellCommand: `true`
- canCreatePythonBlockDraft: `true`
- canAnswerOnly: `false`

情報不足でもユーザーへ質問せず、保守的に何かを commit する。

`??` はこの action の alias である。

### `@@write`

ユーザーの指示に基づき、note へ Markdown を挿入する汎用 action。

- promptRequired: `true`
- readScope: `entire-workspace`
- canInsertMarkdown: `true`
- canEditWorkspaceFiles: `false`
- canRunShellCommand: `true`
- canCreatePythonBlockDraft: `false`
- canAnswerOnly: `false`

AI が commit tool を呼ばず通常回答だけ返した場合は、popup 内に回答を残し、ユーザーが追加でラリーできるようにする。自動 retry は行わない。

### `@@mkpy`

Python analysis block 作成に寄せた action。

`.py` file を workspace に作成し、必要なら Python block draft を生成し、最終的には Markdown として `itg-notes` block を cursor 位置へ挿入する。

- promptRequired: `true`
- readScope: `entire-workspace`
- canInsertMarkdown: `true`
- canEditWorkspaceFiles: `true`
- canRunShellCommand: `true`
- canCreatePythonBlockDraft: `true`
- canAnswerOnly: `false`

`>>` はこの action の alias である。

AI が commit tool を呼ばず通常回答だけ返した場合は、popup 内に回答を残し、ユーザーが追加でラリーできるようにする。自動 retry は行わない。

### `@@ask`

Inline popup 内で回答を得るための action。

note へは反映しない。

- promptRequired: `true`
- readScope: `entire-workspace`
- canInsertMarkdown: `false`
- canEditWorkspaceFiles: `false`
- canRunShellCommand: `true`
- canCreatePythonBlockDraft: `false`
- canAnswerOnly: `true`

## Action 定義ファイル

Inline Action は workspace root 配下の `.inline-action/*.md` で定義する。

`.inline-action` は hidden/system 的な設定フォルダとして扱う。Explorer の hidden 表示が OFF の通常状態では file tree に表示しないが、hidden 表示を ON にした場合は workspace 上の folder として見えてよい。

編集の主導線は専用の Inline Action 管理 UI とする。`.inline-action` は search、managed data auto-register、AI workspace snapshot の対象からは除外する。

MVP では workspace template 機構により、標準 action 定義も `.inline-action/*.md` として展開される。

### Source of truth

展開後は `cwd/.inline-action/*.md` が action 定義の source of truth である。

ただし MVP では、workspace template の「初期化/更新」操作により `.inline-action` を含む template 全体が強制上書きされ得る。

### File format

定義ファイルは frontmatter + Markdown body 形式とする。

frontmatter は action metadata を表す。

body はその action の system prompt として扱う。

例:

```md
---
name: write
description: ノートへMarkdownを挿入します。
promptRequired: true
readScope: entire-workspace
canInsertMarkdown: true
canEditWorkspaceFiles: false
canRunShellCommand: true
canCreatePythonBlockDraft: false
canAnswerOnly: false
---

You are running inside the IntegralNotes @@write inline action.
Use the current Markdown document and workspace evidence when needed.
When the insertion is ready, call insertMarkdownAtCursor with exactly the Markdown that belongs at the cursor.
```

## Frontmatter schema

### `name`

必須。

`@@name` の `name` 部分として使う。

英数字、hyphen、underscore のみ許可する。

例:

- `write`
- `mkpy`
- `ask`
- `my-action`

### `description`

任意。

Action picker に表示する説明文。

### `promptRequired`

必須。

- `true`: action 起動後、user prompt popup を表示する
- `false`: user prompt なしで即実行する

MVP では `optional` は持たない。

### `readScope`

必須。

AI が workspace を読む範囲を表す。

候補:

- `current-document-only`
- `current-document-and-selected-files`
- `selected-files`
- `same-folder`
- `specific-dirs`
- `entire-workspace`

`specific-dirs` を使う場合は、別途 `readDirs` を指定する。

### `readDirs`

任意。

`readScope: specific-dirs` の場合に使う workspace relative directory path の配列。

管理 UI では改行区切りで指定する。

### `canInsertMarkdown`

必須。

`true` の場合、commit tool として `insertMarkdownAtCursor` を渡す。

`itg-notes` block も Markdown としてこの tool で挿入する。

### `canEditWorkspaceFiles`

必須。

`true` の場合、AI が workspace file を作成・編集できる tool を使える。

`@@mkpy` では `.py` 作成のために `true` とする。

### `canRunShellCommand`

必須。

`true` の場合、AI が `runShellCommand` を使える。

実行時は既存の承認 dialog を必ず挟む。

### `canCreatePythonBlockDraft`

必須。

`true` の場合、helper tool として `createPythonBlockDraft` を渡す。

この tool は note を変更しない。

### `canAnswerOnly`

必須。

`true` の場合、commit なしの assistant answer を最終完了として許可する。

`false` の action でも、情報不足時に popup 内で質問・説明するラリーは許可する。ただし最終完了は commit を期待する。

## Commit model

MVP では最終 commit tool は `insertMarkdownAtCursor` に統一する。

Python block も、最終的には `itg-notes` fenced code block を Markdown として挿入する。

これにより、AI は Python block draft を受け取った後に `in:` / `params:` / `out:` を文脈に合わせて編集できる。

## `createPythonBlockDraft`

`createPythonBlockDraft` は helper tool であり、commit tool ではない。

入力:

```ts
{
  scriptPath: string;
  functionName: string;
}
```

出力:

```ts
{
  markdown: string;
}
```

動作:

- workspace sync / catalog / decorator discovery を利用する
- `scriptPath:functionName` に対応する block definition が見つかれば、その slot 定義を使って `itg-notes` block draft を生成する
- 見つからなければ fallback として `run: scriptPath:functionName` を持つ最小 `itg-notes` block draft を生成する
- note は変更しない

AI は返された draft を必要に応じて編集し、最終的に `insertMarkdownAtCursor` へ渡す。

## Prompt behavior

### Prompt required action

`promptRequired: true` の action は user prompt が空の状態では送信できない。

AI が commit tool を呼ばず通常回答だけ返した場合は、popup を閉じず、回答を会話履歴に残す。

自動で「tool を呼んでください」と retry する処理は入れない。

### Promptless action

`promptRequired: false` の action は選択直後に即実行する。

標準では `@@continue` が該当する。

`@@continue` は質問せず、現在の editor context と許可された read scope から保守的に commit する。

## Read scope

現在の editor context は常に action prompt に含める。

- active note path
- documentMarkdown
- beforeText
- afterText
- selected workspace paths
- insertion position

`readScope` は、AI が追加で workspace tool を通じて読める範囲を制御する。

### `current-document-only`

現在開いている Markdown document だけを前提にする。

workspace file の追加読み取りは行わない。

### `current-document-and-selected-files`

現在 document に加え、ユーザーが選択している workspace file を読める。

`@@continue` の標準設定。

### `selected-files`

選択ファイルのみを読める。

### `same-folder`

active note と同じ folder 配下を読める。

### `specific-dirs`

frontmatter の `readDirs` で指定された directory 配下を読める。

### `entire-workspace`

workspace root 全体を読める。

## UI

### Action picker

`@@` 入力時に表示する。

表示項目:

- action name
- description

操作:

- `@@` 入力直後に候補を表示する
- 続けて `@@w` のように入力すると、action name に前方一致する候補だけを表示する
- 上下キーで候補を選択する
- Enter / Tab、または click で選択する
- action name を最後まで手入力した場合も、該当 action を直接起動する

選択後:

- `promptRequired: true`: user prompt popup を開く
- `promptRequired: false`: 即実行する

### Prompt popup

既存 inline AI popup を拡張して使う。

表示項目:

- action name
- description
- conversation history
- streaming assistant text
- user prompt textarea

### Action 管理 UI

`.inline-action/*.md` を GUI から作成・編集できる UI を用意する。

MVP で最低限必要な編集項目:

- name
- description
- promptRequired
- readScope
- canInsertMarkdown
- canEditWorkspaceFiles
- canRunShellCommand
- canCreatePythonBlockDraft
- canAnswerOnly
- system prompt body

## Workspace template との関係

標準 action 定義は workspace template に含める。

例:

```text
workspace-template/
  .inline-action/
    continue.md
    write.md
    mkpy.md
    ask.md
```

workspace template 機構により、空 workspace の初期化時、または明示的な「初期化/更新」操作時に cwd へ展開される。

MVP では template 展開は強制上書きでよい。

## MVP 対象外

- `$$skill` trigger
- action と skill の統合 picker
- action 定義の version 管理
- 標準 action のユーザー編集検知
- template 更新時の merge / conflict 解決
- read scope の高度な permission model
- action ごとの model selection
- action ごとの temperature など model parameter

## Commit tool の終了条件

Inline Action の commit tool は terminal tool として扱う。`insertMarkdownAtCursor` が成功したら、agent は追加の最終応答生成を待たずに終了し、renderer が返却された Markdown を挿入する。旧 `insertPythonBlock` 経路も同じく terminal tool とする。
