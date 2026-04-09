# shimadzu-lc

LC 系 block を提供する sample external plugin source です。

- manifest
  - `integral-plugin.json`
- renderer
  - `renderer/index.html`
- host
  - `host/index.cjs`

現在は `LC.Method.Gradient` を提供します。
renderer は `gradient.png` をテンプレート画像として参照しつつ、`analysis-time` と `time-prog` を GUI 編集できる sample です。

ローカル install:

- `npm run where:local`
- `npm run install:local`

配布物生成:

- `npm run package:release`
- repo root からは `npm run plugins:package:shimadzu-lc`

生成先:

- `plugins/dist/shimadzu.lc/`
  - `shimadzu.lc-0.1.0.zip`
  - `install-shimadzu.lc.bat`
  - `uninstall-shimadzu.lc.bat`
