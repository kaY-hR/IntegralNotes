# standard-graphs

標準グラフ系 block を提供する sample external plugin source です。

- manifest
  - `integral-plugin.json`
- renderer
  - `renderer/index.html`
- host
  - `host/index.cjs`

現在は `StandardGraphs.Chromatogram` を提供します。

ローカル install:

- `npm run where:local`
- `npm run install:local`

配布物生成:

- `npm run package:release`

生成先:

- `plugins/dist/integralnotes.standard-graphs/`
  - `integralnotes.standard-graphs-0.1.0.zip`
  - `install-integralnotes.standard-graphs.bat`
  - `uninstall-integralnotes.standard-graphs.bat`
