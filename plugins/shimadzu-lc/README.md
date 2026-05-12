# shimadzu-lc

LC 系 block を提供する sample external plugin source です。

- manifest
  - `integral-plugin.json`
- renderer
  - `renderer/index.html`
- host
  - `host/index.cjs`

現在は `run-sequence` を提供します。
renderer は `gradient.png` を使ったシンプル表示のみです。初期濃度・グラジエント終濃度・初期濃度維持時間・グラジエント時間・最終濃度切替時刻・分析終了時刻を画像左側/下側の軸ラベル input として編集できます。`method` input は `.lcm` を読み込み対象にします。`装置操作を実行` は renderer 上部のボタンから `integral:request-action` 経由で起動します。

ローカル install:

- `npm run where:local`
- `npm run install:local`

配布物生成:

- `npm run package:release`
- repo root からは `npm run plugins:package:shimadzu-lc`

生成先:

- `plugins/dist/shimadzu-lc/`
  - `shimadzu-lc-0.1.0.zip`
  - `install-shimadzu-lc.bat`
  - `uninstall-shimadzu-lc.bat`
