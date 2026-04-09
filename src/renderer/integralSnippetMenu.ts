import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import { commandsCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { insert } from "@milkdown/kit/utils";

import { INTEGRAL_BLOCK_LANGUAGE } from "./integralBlockRegistry";

interface IntegralSnippetTemplate {
  key: string;
  label: string;
  markdown: string;
}

const SNIPPET_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M7 5H17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M7 9H17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M7 13H13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M6 18L9 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M9 18L6 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  <path d="M15 18H18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
</svg>
`.trim();

function toIntegralCodeBlock(value: unknown): string {
  return [`\`\`\`${INTEGRAL_BLOCK_LANGUAGE}`, JSON.stringify(value, null, 2), "```"].join("\n");
}

const INTEGRAL_SNIPPETS: readonly IntegralSnippetTemplate[] = [
  {
    key: "integral-lc-gradient",
    label: "LCのグラジエント設定",
    markdown: toIntegralCodeBlock({
      type: "LC.Method.Gradient",
      params: {
        "analysis-time": 8,
        "time-prog": [
          { time: 0, Conc: 10 },
          { time: 8, Conc: 100 }
        ]
      }
    })
  },
  {
    key: "integral-standard-chromatogram",
    label: "クロマトグラム表示",
    markdown: toIntegralCodeBlock({
      type: "StandardGraphs.Chromatogram",
      params: {
        data: ["lc1.lcd", "lc2.lcd"]
      }
    })
  }
];

export const integralSnippetFeatureConfigs: NonNullable<CrepeConfig["featureConfigs"]> = {
  [Crepe.Feature.BlockEdit]: {
    buildMenu: (builder) => {
      const integralGroup = builder.addGroup("integral", "Integral");

      for (const snippet of INTEGRAL_SNIPPETS) {
        integralGroup.addItem(snippet.key, {
          icon: SNIPPET_ICON,
          label: snippet.label,
          onRun: (ctx) => {
            const commands = ctx.get(commandsCtx);

            commands.call(clearTextInCurrentBlockCommand.key);
            insert(snippet.markdown)(ctx);
          }
        });
      }
    }
  }
};
