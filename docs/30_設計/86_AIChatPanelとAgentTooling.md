# AI Chat Panel と Agent Tooling

## 目的

IntegralNotes に、`Claude Code` / `Codex` / `GitHub Copilot Chat` に近い coding chat panel を追加する。  
ただし本 branch の文書では「理想像」ではなく、**現時点で実装済みの構成**と、**まだ未実装の範囲**を分けて整理する。

## この branch で確定したこと

- `AI Chat` は `Activity Bar` の built-in workspace-tool item として配置し、クリックで main workspace の `FlexLayout` tab を開く
- chat UI は renderer に置き、model 呼び出し・tool 実行・skills 読み込みは main process に置く
- runtime は `Vercel AI Gateway 固定` ではなく、
  - `anthropic/*` は `ANTHROPIC_API_KEY`
  - `openai/*` は `OPENAI_API_KEY`
  - それらが無い場合のみ `AI Gateway`
  の順で選ぶ
- 汎用探索は `bash-tool` を使う
- skills は repo の `.codex/skills` を source of truth にし、`experimental_createSkillTool()` で読む
- `readWorkspaceImage` / `renderWorkspaceDocument` / `writeWorkspaceFile` を main process 側の typed tool として追加した
- transcript には assistant message だけでなく tool 実行も `tool` role message として表示する
- `MCP` は**まだ未実装**で、registry も add UI も無い

## 現在の構成

```text
Renderer (React)
  AIChatPanel
    -> preload IPC
    -> ai-chat:getStatus / saveSettings / clearApiKey / refreshModels / submit

Main Process
  AiChatService
    -> model catalog / auth resolution / history normalization
    -> AiAgentService.submit()

  AiAgentService
    -> ToolLoopAgent.generate()
    -> bash-tool runtime
    -> skill tool (.codex/skills)
    -> typed workspace tools

  WorkspaceVisualRenderService
    -> hidden BrowserWindow render
    -> capturePage()
```

補足:

- 現在は `ToolLoopAgent.stream()` ではなく `ToolLoopAgent.generate()` を使う request/response 方式である
- renderer は `useChat` transport ではなく、React state + IPC invoke で管理している

## UI 設計

### 配置

- `Activity Bar` に `builtin:ai-chat` icon を追加済み
- クリック時に main workspace 側へ `AI Chat` tab を開く
- AI Chat は sidebar view ではなく、長い会話を前提にした main workspace tab とする

### panel 内 UI

- header には runtime mode / provider label / MCP status pill を出す
- 設定は inline section ではなく `Settings` dialog に分離する
- current workspace context は `Context` dialog に分離する
- 本文領域は message list を優先し、composer を panel 下部に固定する
- tool 実行は assistant の内部 state ではなく、独立した `tool` message として transcript に差し込む
- user は画像ファイルを添付できる
- prompt 文中に画像 path が書かれている場合も、可能なら画像 attachment 化する

### 現在の status 表示

- `MCP connected` ではなく `MCP not wired` を出す
- これは未接続ではなく、**機能自体がまだ wiring されていない**ことを示す

## 認証と model 選択

### model catalog

- model 一覧は `https://ai-gateway.vercel.sh/v1/models` を live fetch する
- 失敗時のみ fallback catalog を使う
- model catalog は main process 側 cache を持つ

### runtime 選択

優先順位:

1. `anthropic/*` model で `ANTHROPIC_API_KEY` があるなら direct Anthropic
2. `openai/*` model で `OPENAI_API_KEY` があるなら direct OpenAI
3. 上記が無い場合で `AI_GATEWAY_API_KEY` または `VERCEL_OIDC_TOKEN` があれば AI Gateway
4. どれも無ければ stub

### credential 読み取り元

- `process.env`
- workspace `.env.local`
- workspace `.env`
- 保存済み `AI Gateway API Key`

保存済み key の扱い:

- 保存対象は `AI Gateway API Key` のみ
- 保存先は app `userData/ai-chat-settings.json`
- `safeStorage` が使える環境では暗号化、使えない場合は平文

## proxy 対応

main process 起動時に proxy を初期化する。

対応 env:

- `HTTPS_PROXY` / `https_proxy`
- `HTTP_PROXY` / `http_proxy`
- `NO_PROXY` / `no_proxy`
- `PROXY_HTTPS` / `proxy_https`
- `PROXY_HTTP` / `proxy_http`
- `PROXY_NO` / `proxy_no`

`undici` の global dispatcher に反映するため、AI Gateway / direct provider の両方に効く。

## agent runtime

### 基本

- `AiAgentService` が `ToolLoopAgent.generate()` を呼ぶ
- stop 条件は `stepCountIs(8)`
- renderer には
  - final assistant text
  - finish reason
  - model id
  - step count
  - tool trace
  を返す

### empty assistant text の扱い

モデルが tool を呼んだだけで最終 text を返さない場合がある。  
そのため現状では、tool trace が残っていれば fallback assistant text を生成して例外にしない。

これは本質的な UX 解決ではなく、**`assistant text 空` で panel 全体が失敗しないための安全策**である。

### tool trace

tool trace は step 単位ではなく transcript message としても表示する。  
現在の summary 対象:

- `bash`
- `readFile`
- `writeFile`
- `writeWorkspaceFile`
- `readWorkspaceImage`
- `renderWorkspaceDocument`

## workspace 探索と `bash-tool`

### 採用方針

- 基本の探索は `bash-tool` を使う
- `rg`, `find`, `ls`, `cat`, `jq` など Unix-style command を agent に使わせる

### 現在の実装方式

現在の branch では、real workspace を live mount するのではなく、**submit 時に workspace snapshot を in-memory files として `bash-tool` に渡す**。

理由:

- `just-bash` / `OverlayFs` の Windows 挙動が publish 版ではまだ不安定
- 特に子 path 解決で `No such file or directory` が再現した
- そのため current branch では Windows workaround として snapshot preload を採用している

### snapshot の内容

- readable text file は本文を preload
- binary / oversized file は placeholder text にして存在だけ discoverable にする
- 画像も placeholder により `find` / `ls` には出る

制限:

- 最大 5,000 files
- text preload は 1 file 1MB まで
- image inspect は 8MB まで
- `.git`, `node_modules`, `dist`, `out` などは除外

### write の扱い

- `bash/writeFile` は overlay preview 専用で、real workspace には保存しない
- real save は `writeWorkspaceFile` tool を使う

## skills

- `.codex/skills` を最優先で読む
- `experimental_createSkillTool()` の結果を `bash-tool` runtime に統合する
- skill 自体は recipe であり、filesystem write や command 実行の権限そのものではない

現時点では `.codex/skills` の deep integration は最小限で、approval policy や richer UI はまだ無い。

## typed workspace tools

### `writeWorkspaceFile`

目的:

- real workspace への UTF-8 text save
- `bash/writeFile` の preview と区別する

現状:

- `.md` は `workspaceService.saveNote()` を通す
- それ以外の text file は直接 write する
- patch preview / approve UI はまだ無い

### `readWorkspaceImage`

目的:

- agent が `find` や `rg` で画像 path を見つけた後、その path を引数に real workspace の画像を読めるようにする

現状:

- `png`, `jpg`, `webp`, `svg` など主要画像を base64 + media type で model に返す
- prompt に path が書かれていた場合の attachment 化とは別経路

### `renderWorkspaceDocument`

目的:

- `markdown` / `html` / `text` を「見た目」で確認させる
- 埋め込み HTML chart や markdown 内 raw HTML を screenshot として model に渡す

現状:

- hidden `BrowserWindow` で描画して `capturePage()` する
- markdown は `micromark + gfm` で HTML 化し、raw HTML を保持する
- workspace-root 相対の `src` / `href` は file URL に rewrite する
- output には `renderReadiness` を付与する

補足:

- `renderReadiness` は `document.readyState`、fonts、Plotly container、`svg/canvas/img` の実サイズなどを見た結果である
- それでも visual render は best-effort であり、外部 asset や複雑な script に完全対応しているわけではない

## transcript と message model

message role は次を持つ。

- `user`
- `assistant`
- `tool`

追加済み情報:

- image attachments
- assistant diagnostics
  - `modelId`
  - `finishReason`
  - `stepCount`
  - `toolTrace`
- tool message ごとの input / output summary

これにより、Claude Code / Codex 風に「どの tool が何をしたか」を会話面から追える。

## Activity Bar / Sidebar との関係

- `AI Chat` は sidebar view ではなく built-in workspace-tool item である
- `Explorer` / `Search` / `Plugins` とは別 registry で扱う
- `Process Chain` と同じ category の built-in workspace tab opener として扱う

## 現時点で未実装

- streaming response
- chat cancel / abort
- explicit diff preview / approval UI
- host command tool
- generic MCP client registry
- MCP server add / enable / disable UI
- persistent write の conflict handling
- multi-session 永続化
- background autonomous agent

## MCP の現状

この branch では **MCP は設計のみで、実装はまだ無い**。

未実装のもの:

- `@ai-sdk/mcp` による client registry
- remote HTTP / SSE / Streamable HTTP transport
- local stdio transport
- UI 上の server add / enable / disable
- namespaced MCP tool export

したがって、現時点では `Vercel MCP` も generic MCP server も接続できない。

## 次段で実装する候補

優先度順に見ると、次はこの順が自然である。

1. streaming + cancel
2. host command tool
3. write preview / approval UI
4. MCP registry
5. session persistence

## open questions

- `bash-tool` を将来的に `OverlayFs` へ戻すか、それとも snapshot preload を正式方針にするか
- real workspace write を patch ベース approval に寄せるか、file save を許すか
- host command approval を message 単位にするか、session policy にするか
- MCP 設定を workspace local に置くか、user global に置くか
- trace / session 保存先を workspace metadata に置くか、app userData に置くか

## 参考

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
