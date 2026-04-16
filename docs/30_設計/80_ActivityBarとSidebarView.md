# Activity Bar と Sidebar View

## 目的

VS Code の Activity Bar のように、Explorer のさらに左に縦メニューバーを置き、  
左サイドの pane を built-in / plugin の両方で切り替えられるようにする。

## 基本方針

- Activity Bar shell 自体は app core が持つ
- 左サイドの中身は `sidebar view` として切り替える
- built-in と external plugin を同じ registry で扱う
- `viewer plugin` や `block plugin` とは別 contribution にする

## 用語整理

### Activity Bar

最も左の縦アイコン列。  
ここでは「どの sidebar view を表示するか」を切り替えるだけで、view 本体は持たない。

### Sidebar Host

Activity Bar の右隣にある pane 本体。  
active な sidebar view を 1 つ描画する。

### Sidebar View

Sidebar Host の中に表示される実体。

例:

- Explorer
- Plugins
- 将来の Search
- 装置 plugin 独自 navigator

## MVP 構成

### built-in views

- `builtin:explorer`
- `builtin:plugins`

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
- built-in Plugins
- installed external plugin の `sidebarViews`

を merge して Activity Bar と Sidebar Host の両方で使う。

## built-in view の扱い

Explorer も Plugins も特別扱いせず、built-in sidebar view として registry に載せる。  
これにより、UI shell は「どの view でも同じ」にできる。

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
- Plugin Manager も built-in sidebar view
- dialog としての Plugin Manager は廃止してよい

## 非目標

MVP では次はまだやらない。

- drag で sidebar width を自由に resize
- Activity Bar item の並び替え
- plugin sidebar view から app への汎用 command bridge
- Search や SCM のような built-in view 一式
