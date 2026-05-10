# plugins

このディレクトリは、IntegralNotes plugin の source と sample 実装の置き場です。

- `plugins/shimadzu-lc`
  - LC 系 block の sample plugin source
- `plugins/image-analysis-pack`
  - `.icv` viewer、画像解析 skill、Python helper/template をまとめた package source
- `plugins/dist`
  - zip / bat の配布物出力先

app runtime はここを直接読みません。  
standalone runtime plugin を動かすには `%LocalAppData%/IntegralNotes/runtime-plugins` へ install する必要があります。
package を動かすには `%LocalAppData%/IntegralNotes/packages` へ install します。

third-party plugin の最終形は、このディレクトリに入ること自体が必須ではありません。  
別 repo / 別 build 環境で同じ artifact を作り、IntegralNotes の global extension root へ install できれば十分です。

## 開発用 install

- repo 全体からまとめて install
  - `npm run plugins:install:all`
- install 先確認
  - `npm run plugins:where`
- 各 plugin 単位
  - `npm --prefix plugins/shimadzu-lc run install:local`

installer は既定で `%LocalAppData%/IntegralNotes/runtime-plugins` を使う。  
`--target-root` または `INTEGRALNOTES_PLUGIN_INSTALL_ROOT` で上書きできる。

## 配布物生成

- 全 plugin
  - `npm run plugins:package:all`
- root から plugin 単位
  - `npm run plugins:package:shimadzu-lc`
- plugin 単位
  - `npm --prefix plugins/shimadzu-lc run package:release`

配布物は `plugins/dist/<pluginId>/` に生成されます。
