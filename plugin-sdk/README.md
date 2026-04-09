# plugin-sdk

IntegralNotes plugin の contract をまとめるためのローカル SDK です。

- `docs/開発者向けアナウンス.md`
  - external-only 前提、zip 配布、GUI install の考え方
- `schemas/integral-plugin.schema.json`
  - manifest schema
- `src/*.js`
  - manifest / renderer / host / installer 向け helper
- `src/*.d.ts`
  - TypeScript plugin 向け型定義

renderer helper の主な用途:

- `bindIntegralPluginRenderer(render)`
  - app -> plugin の `integral:set-block` を受ける
- `postIntegralPluginParamsUpdate(params)`
  - plugin -> app の `integral:update-params` を送る
