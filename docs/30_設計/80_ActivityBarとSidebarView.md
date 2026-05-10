# Activity Bar と Sidebar View

## 目的

VS Code の Activity Bar のように、Explorer のさらに左に縦メニューバーを置き、  
左サイドの pane を built-in / plugin の両方で切り替えられるようにしつつ、  
必要なら Activity Bar から main workspace tab を開く workspace-tool plugin item も置けるようにする。

## 基本方針

- Activity Bar shell 自体は app core が持つ
- Activity Bar item は `sidebar view 切替` と `main workspace tab opener` の両方を持てる
- 左サイドの中身は `sidebar view` として切り替える
- built-in sidebar view と external plugin sidebar view は同じ registry で扱う
- main workspace tab opener は optional な `workspace-tool plugin` contribution として別 registry で扱う
- `viewer plugin` や `block plugin` とは別 contribution にする

## 用語整理

### Activity Bar

最も左の縦アイコン列。  
ここでは `sidebar view` を切り替える item と、main workspace の tab を開く workspace-tool plugin item を並べてよい。

### Sidebar Host

Activity Bar の右隣にある pane 本体。  
active な sidebar view を 1 つ描画する。

### Sidebar View

Sidebar Host の中に表示される実体。

例:

- Explorer
- Search
- 装置 plugin 独自 navigator

## MVP 構成

### built-in views

- `builtin:explorer`
- `builtin:search`

### workspace-tool plugin items

- `builtin:ai-chat`
- `builtin:process-chain-viewer`
- `builtin:extensions`
- main workspace 側に tab を開く built-in / optional item 群

### external views

plugin manifest の `sidebarViews` contribution から追加する。

## レイアウト

```text
| Activity Bar | Sidebar Host | Main Workspace |
```

初版は 3 列固定でよい。

- Activity Bar
  - narrow fixed width
- Sidebar Host
  - Explorer 相当の固定幅
- Main Workspace
  - 残り全部

## registry

renderer 側では、最終的に次の形へ正規化して扱う。

```ts
type SidebarViewDefinition = {
  id: string;
  title: string;
  activityIcon: ReactNode;
  render: () => JSX.Element;
};
```

ここへ

- built-in Explorer
- installed external plugin の `sidebarViews`

を mergeした `sidebar item` 群と、別途

- provenance pane
- AI Chat
- Extensions

のような `main tab opener item` 群を Activity Bar に載せてよい。

## process chain viewer

process chain viewer は sidebar view ではなく、optional な internal workspace-tool plugin として Activity Bar から開く main workspace tab とする。

- 対象は今開いている note 内の全 block、または今見ている file を起点にした chain
- node は block / file を同程度の重みで扱う
- note を起点にした場合は、各 block の直系 ancestor / descendant だけを辿り、shared input を使う sibling branch は出さない
- node click で元の file / block を開き、block node は `note-path#BLK-...` の deep link で位置復帰できるとよい
- edge は `out = right`, `in = left` の固定 port に接続する
- hover preview は file node だけを対象に後段で追加してよい

現状の external plugin API は iframe sidebar view が中心なので、process chain viewer は external plugin ではなく internal plugin category として実装する。

## built-in view の扱い

Explorer と Search は特別扱いせず、built-in sidebar view として registry に載せる。  
これにより、sidebar UI shell は「どの view でも同じ」にできる。

Extensions は sidebar view ではなく、main workspace tab を開く built-in workspace-tool item とする。  
拡張機能管理タブの詳細は `docs/30_設計/56_拡張機能管理タブ.md` を参照。

## external plugin view の扱い

### manifest

例:

```json
{
  "sidebarViews": [
    {
      "id": "navigator",
      "title": "Navigator",
      "description": "plugin 固有のサイドビュー",
      "icon": "NV",
      "renderer": {
        "entry": "sidebar/index.html",
        "mode": "iframe"
      }
    }
  ]
}
```

### load

1. main process は plugin manifest を読む
2. `sidebarViews[].renderer.entry` を解決する
3. renderer は `loadPluginSidebarViewDocument(pluginId, sidebarViewId)` で `srcDoc` を得る
4. iframe load 後に `integral:set-sidebar-view` を送る

## message contract

app -> plugin:

- `integral:set-sidebar-view`

payload:

```json
{
  "plugin": {
    "id": "example-plugin",
    "displayName": "Example Plugin",
    "description": "...",
    "namespace": "example",
    "origin": "external",
    "version": "0.1.0"
  },
  "sidebarView": {
    "id": "navigator",
    "title": "Navigator",
    "description": "...",
    "icon": "NV"
  }
}
```

first version では metadata だけを渡す。  
workspace 操作や richer action bridge は後続で足す。

## keyboard / focus

- Explorer 専用 shortcut は Explorer view が active なときだけ有効にする
- Activity Bar button 自体に Explorer の rename / delete shortcut はぶら下げない
- focus 判定は Activity Bar ではなく Sidebar Host の active view に対して行う

## 既存 UI からの移行

### 以前

- `App.tsx` に explorer sidebar が直書き
- Plugin Manager は modal dialog

### 移行後

- `App.tsx` は `ActivityBar + Sidebar Host + Workspace` の shell を持つ
- Explorer は built-in sidebar view
- Search は built-in sidebar view
- Extensions は built-in workspace-tool item として main workspace tab を開く
- dialog としての Plugin Manager は廃止してよい

## 非目標

MVP では次はまだやらない。

- drag で sidebar width を自由に resize
- Activity Bar item の並び替え
- plugin sidebar view から app への汎用 command bridge
- SCM のような built-in view 一式

## Search view

Search は built-in sidebar view として実装する。

- renderer 側は `SearchSidebarView` が query / replace / include / exclude / option toggle を描画する
- host は `workspace:searchText` / `workspace:replaceText` IPC を呼ぶ
- 検索対象は workspace 内の text file とし、binary / image は除外する
- 検索結果は file ごとにまとめて表示し、click で既存の file open 経路を使う
- replace は current query と同じ条件で file を書き戻す
- dirty な markdown tab と衝突する replace は renderer 側で止める
