import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import { commandsCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { insert } from "@milkdown/kit/utils";

import type { PluginBlockContribution } from "../shared/plugins";

import { INTEGRAL_BLOCK_LANGUAGE } from "./integralBlockRegistry";
import { getInstalledIntegralPlugins } from "./integralPluginRuntime";

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

const KNOWN_SNIPPET_TEMPLATES: Readonly<Record<string, { label: string; value: unknown }>> = {
  "LC.Method.Gradient": {
    label: "LCのグラジエント設定",
    value: {
      type: "LC.Method.Gradient",
      params: {
        "analysis-time": 8,
        "time-prog": [
          { time: 0, Conc: 10 },
          { time: 8, Conc: 100 }
        ]
      }
    }
  },
  "StandardGraphs.Chromatogram": {
    label: "クロマトグラム表示",
    value: {
      type: "StandardGraphs.Chromatogram",
      params: {
        data: ["lc1.lcd", "lc2.lcd"]
      }
    }
  }
};

export function createIntegralSnippetFeatureConfigs(): NonNullable<CrepeConfig["featureConfigs"]> {
  return {
    [Crepe.Feature.BlockEdit]: {
      buildMenu: (builder) => {
        const snippets = createIntegralSnippetTemplates();

        if (snippets.length === 0) {
          return;
        }

        const integralGroup = builder.addGroup("integral", "Integral");

        for (const snippet of snippets) {
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
}

function createIntegralSnippetTemplates(): IntegralSnippetTemplate[] {
  const snippets: IntegralSnippetTemplate[] = [];

  for (const plugin of getInstalledIntegralPlugins()) {
    for (const block of plugin.blocks) {
      snippets.push(toIntegralSnippetTemplate(block));
    }
  }

  return snippets;
}

function toIntegralSnippetTemplate(block: PluginBlockContribution): IntegralSnippetTemplate {
  const knownTemplate = KNOWN_SNIPPET_TEMPLATES[block.type];

  return {
    key: `integral-${toSnippetKeySegment(block.type)}`,
    label: knownTemplate?.label ?? block.title,
    markdown: toIntegralCodeBlock(knownTemplate?.value ?? { type: block.type })
  };
}

function toSnippetKeySegment(type: string): string {
  const normalized = type.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  const trimmed = normalized.replace(/^-+/u, "").replace(/-+$/u, "");

  return trimmed.length > 0 ? trimmed : "block";
}
