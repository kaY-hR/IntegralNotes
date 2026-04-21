# AI Chat Panel と Agent Tooling

## 目的

IntegralNotes に、`Claude Code` / `Codex` / `GitHub Copilot Chat` に近い coding chat panel を追加する。  
この panel は単なる Q&A ではなく、現在の workspace を読み、必要なら編集し、command を実行し、skills と MCP を使って外部 capability も呼べる agent UI とする。

今回の文書では次を決める。

- chat panel の配置
- Vercel AI SDK / AI Gateway をどう使うか
- `cwd` 内検索 / read / write / command / skills / MCP の実装方針
- first version の範囲

## 結論

- AI Chat は `Activity Bar` から開く main workspace tab とする
- renderer は AI SDK UI を使って chat state と stream 描画を持つ
- provider 呼び出し、tool 実行、skill 読み込み、MCP client 接続は renderer ではなく main process に置く
- model transport の第一候補は `Vercel AI Gateway` とするが、app 内 abstraction は gateway 固定にしない
- 汎用な codebase 探索は `bash-tool` を使う
- ただし `bash-tool` は「与えた filesystem / sandbox 上で動く tool」であり、local workspace へ自動で触れるわけではない
- そのため Electron app では、main process 側で local workspace を mount した runtime を作る
- skills は `bash-tool` の skill tool を使い、repo の `.codex/skills` を source of truth にする
- MCP は `@ai-sdk/mcp` client を main process に持ち、remote HTTP 系と local stdio 系の両方を受ける
- ただし `Vercel MCP` そのものは 2026-01-30 時点 docs で「Vercel が review / approve した client のみ接続可」とされているため、IntegralNotes 独自 client が直ちに使える前提には置かない

## なぜ純粋な Vercel Sandbox 前提にしないか

ユーザーが欲しいのは「今開いている local workspace に対して Claude Code 的に動く chat」である。  
ここで重要なのは、`bash-tool` や `Vercel Sandbox` は local `cwd` の魔法の代理ではない、という点である。

- `bash-tool` は、与えた filesystem または sandbox 上で `bash` / `readFile` / `writeFile` を提供する
- remote sandbox を使う場合、local workspace をそこへ同期しない限り、agent は手元の file を見られない
- remote 側へ workspace mirror を作る方式は、dirty tab、frontmatter 保持、`.idts`、hidden data-note、外部 command 実行契約と衝突しやすい

したがって first version では次を採る。

- model 呼び出しは API ベースでよい
- しかし workspace 操作は local Electron main process 側で行う
- `bash-tool` の実行基盤は local workspace mount を前提にする

## 全体構成

```text
Renderer (React)
  AIChatPanel
    -> preload IPC

Main Process
  aiAgentService
    -> ToolLoopAgent
    -> model transport (AI Gateway / OpenAI-compatible)
    -> bash-tool runtime
    -> skill tool
    -> MCP client registry
    -> workspaceService / integralWorkspaceService
    -> host command runner
```

責務分離:

- renderer
  - message list
  - composer
  - tool call 状態表示
  - diff preview / approval UI
- main process
  - provider API key 保持
  - stream 実行
  - tool 実装
  - MCP 接続
  - filesystem / command access

## Chat UI と transport

AI SDK 5 系の `useChat` は transport ベースで構成できる。  
Electron app でわざわざ local HTTP server を立てる必要はないため、renderer には custom transport を置き、preload 経由で main process の agent service へ接続する。

方針:

- renderer は `useChat` 相当の UI state model を使う
- transport は `ElectronChatTransport` のような custom 実装にする
- main process は `ToolLoopAgent.stream()` または `streamText()` を実行し、UI message stream 相当の chunk を IPC で返す
- provider key や BYOK 情報は renderer に出さない

## tool 層の分割

`Claude Code` / `Codex` に近い体験を出すには、tool を 1 種類に寄せすぎない方がよい。  
first version では次の 5 層に分ける。

### 1. 汎用 code tools

基本の探索は `bash-tool` を中心にする。

- `bash`
- `readFile`
- `writeFile`

用途:

- `rg`, `find`, `sed`, `head`, `tail`, `jq` などで必要部分だけ読む
- prompt に workspace 全体を入れず、agent が段階的に探索する

ただし persistent write をいきなり real workspace に通すのは危険なので、write policy は app 側で制御する。

第一案:

- `bash` は `OverlayFs` 相当の copy-on-write mount 上で動かす
- agent は shell 的に編集案を作れる
- app は差分を preview し、承認後に real workspace へ反映する

これにより `bash-tool` の利便性を残しつつ、いきなり disk を壊しにくくできる。

### 2. IntegralNotes 固有 tool

この app には、ただの text file として扱うと壊しやすい対象がある。  
それらは typed tool に分ける。

候補:

- `get_active_context`
  - active tab
  - selected paths
  - current note path
  - current dataset path
- `read_note`
  - frontmatter を壊さない前提で note 本文を読む
- `inspect_dataset`
  - `.idts` manifest を構造化して読む
- `read_data_note`
  - hidden path を直接出さず target ID 起点で読む
- `list_workspace_selection`
  - explorer 選択中 path を返す

これらは既存の `workspaceService.ts` と `integralWorkspaceService.ts` を再利用して実装する。

### 3. persistent write tool

`Claude Code` 的 UX には file write が必要だが、IntegralNotes では unsaved tab や note frontmatter との整合も要る。  
そのため persistent write は `bash` の直接 write ではなく app-owned tool に寄せる。

候補:

- `apply_workspace_patch`
- `write_workspace_file`
- `save_note_body`
- `create_workspace_entry`

基本方針:

- preview なしの即保存はしない
- dirty な tab と衝突する場合は保存前に止める
- note は frontmatter 保持契約を守る

### 4. host command tool

`bash-tool` だけでは `npm run build`, `git diff`, `python -m pytest` のような「実際の project runtime を使う command 実行」を完全には代替しにくい。  
また `just-bash` の docs でも、full VM や arbitrary binary execution が要るなら `Vercel Sandbox` を使うよう案内されている。

そのため coding chat としては別に host command tool を持つ。

候補:

- `run_host_command`

基本方針:

- working directory は workspace root またはその配下に限定する
- destructive command は明示承認制にする
- network を使う command は別 policy にする
- stdout / stderr / exit code を trace として残す

Windows first の app なので、initial shell は `PowerShell` を基準にする。

### 5. skills / MCP tools

generic bash だけでは「この repo 固有の作法」や「外部 SaaS の専用操作」は弱い。  
その穴を skills と MCP で埋める。

## skills 方針

Vercel は 2026-01-21 時点で `bash-tool` の skills 対応を案内しており、skill pattern を bash runtime と併用できる。  
IntegralNotes 側では repo 内にすでに `.codex/skills` を持っているため、これをそのまま活かす。

方針:

- project local の `.codex/skills` を最優先で読む
- 将来的に global skill directory も追加可
- skill 発火は agent 自律でも user explicit でもよいが、first version は explicit or high-confidence match を推奨する
- skill 実行自体は main process 側で行う

注意:

- skill は tool 群の上位レシピであり、権限そのものではない
- 実際の file write / command 実行は通常の approval policy に従わせる

## MCP 方針

### 役割

MCP は「外部 tool / resource / prompt を標準化された形で agent に渡す層」として使う。  
IntegralNotes の AI Chat は first version では `MCP host` 側として振る舞い、外部 MCP server へ client 接続する。

AI SDK 側では `@ai-sdk/mcp` の `createMCPClient()` が使える。  
この client は tools だけでなく resources / prompts / elicitation も扱える。

### 対応する transport

first version で扱う transport:

- remote HTTP / SSE / Streamable HTTP
- local stdio

整理:

- remote HTTP 系は外部 SaaS や self-hosted MCP 向け
- stdio は local の補助 server や agent-friendly script 向け
- AI SDK docs でも production は HTTP transport 推奨、stdio は local server 向けとされている

### Vercel MCP の扱い

Vercel docs の `Use Vercel's MCP server` は 2026-01-30 更新時点で、`https://mcp.vercel.com` は OAuth 付き remote MCP であり、review / approve 済みの client のみ接続可としている。  
したがって IntegralNotes 独自 app がそのまま `Vercel MCP` へ接続できる前提は unsafe である。

ここでの判断:

- app 自体は generic MCP client 対応にする
- `Vercel MCP` は「使えれば使う optional integration」として扱う
- first version の core dependency にはしない

### MCP registry

main process に MCP registry を置く。

保持したい情報:

- server id
- display name
- transport 種別
- endpoint または command
- auth state
- enabled / disabled
- tool allow-list

tool 名は衝突回避のため namespace する。

例:

- `mcp__github__create_issue`
- `mcp__vercel__list_projects`

### 将来の拡張

first version は「外部 MCP server を使う client」でよい。  
ただし将来は逆に IntegralNotes 自身が local MCP server を持ち、

- `read_note`
- `inspect_dataset`
- `execute_block`
- `search_workspace`

などを外部 agent へ公開できる形にしてもよい。  
この場合も、今回の tool contract をそのまま server 側へ再利用できるようにしておく。

## approval と trace

coding chat は便利さより先に、何を読んで何を変えたかを追える必要がある。

最低限必要な UI:

- tool call list
- 実行中 / 完了 / failed 状態
- write preview
- command preview
- approval / deny
- source summary
  - どの file
  - どの skill
  - どの MCP tool
  - どの command

保存先候補:

- in-memory session
- 後段で `.store/.integral/ai/` に session / trace を保存

## MVP

first version でやること:

- Activity Bar から `AI Chat` tab を開ける
- 1 session の会話履歴、streaming、cancel、clear
- active tab / selected path を context として渡せる
- main process 側に `ToolLoopAgent` ベースの agent runtime を置く
- `bash-tool` による local workspace 探索
- IntegralNotes 固有 typed tool の最小集合
- persistent write preview
- 限定的な host command 実行
- `.codex/skills` 読み込み
- MCP registry と、少なくとも 1 つの stdio server または generic remote MCP server 接続

## first version でやらないこと

- remote sandbox への workspace 完全同期
- full autonomous background agent
- unrestricted shell
- unrestricted network
- multi-tab / multi-agent orchestration
- Vercel MCP 直結を必須前提にした OAuth 実装

## 実装単位

追加 / 更新候補:

- `src/shared/aiChat.ts`
  - chat request / response / stream event / approval 型
- `src/main/aiAgentService.ts`
  - agent runtime 本体
- `src/main/aiTools/*`
  - bash tool, typed workspace tool, host command tool
- `src/main/aiSkills.ts`
  - `.codex/skills` 読み込み
- `src/main/aiMcpRegistry.ts`
  - MCP client 管理
- `src/main/main.ts`
  - IPC 登録
- `src/main/preload.ts`
  - renderer bridge
- `src/renderer/AIChatPanel.tsx`
  - UI
- `src/renderer/workspaceToolPlugins.tsx`
  - Activity Bar item 追加
- `src/renderer/styles.css`
  - panel / trace / preview UI

既存再利用:

- `src/main/workspaceService.ts`
- `src/main/integralWorkspaceService.ts`
- `src/shared/workspace.ts`
- `src/shared/integral.ts`

## open questions

- persistent write の最終反映を patch ベースに固定するか、file 単位保存も許すか
- host command の approval granularity を command 単位にするか、session policy にするか
- MCP server 設定を workspace local に置くか、user global に置くか
- skill の自動発火をどこまで許すか
- chat / trace の保存先を workspace 内 metadata に置くか、app user data に置くか

## 参考

- Vercel AI SDK `useChat` / transport
  - https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
  - https://ai-sdk.dev/docs/ai-sdk-ui/transport
- Vercel AI SDK `ToolLoopAgent`
  - https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- Vercel AI SDK MCP client
  - https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client
  - https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- Vercel AI Gateway
  - https://vercel.com/docs/ai-gateway
  - https://vercel.com/docs/ai-gateway/authentication-and-byok/byok
- Vercel bash-tool / filesystem agent
  - https://vercel.com/changelog/introducing-bash-tool-for-filesystem-based-context-retrieval
  - https://vercel.com/academy/filesystem-agents/bash-tool
- Vercel skills
  - https://vercel.com/changelog/use-skills-in-your-ai-sdk-agents-via-bash-tool
  - https://vercel.com/docs/agent-resources/skills
- Vercel MCP
  - https://vercel.com/docs/agent-resources/vercel-mcp
  - https://vercel.com/docs/mcp
- just-bash
  - https://github.com/vercel-labs/just-bash
