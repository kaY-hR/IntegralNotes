import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import { commandsCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { insert } from "@milkdown/kit/utils";

import type { IntegralBlockTypeDefinition } from "../shared/integral";

import {
  INTEGRAL_BLOCK_LANGUAGE,
  createInitialIntegralBlock
} from "./integralBlockRegistry";
import { getAvailableIntegralBlockTypes } from "./integralPluginRuntime";

export const OPEN_PYTHON_SCRIPT_DIALOG_EVENT = "integral:open-python-script-dialog";
export const INSERT_INTEGRAL_BLOCK_MARKDOWN_EVENT = "integral:insert-block-markdown";

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

export function createIntegralSnippetFeatureConfigs(): NonNullable<CrepeConfig["featureConfigs"]> {
  return {
    [Crepe.Feature.BlockEdit]: {
      buildMenu: (builder) => {
        const snippets = createIntegralSnippetTemplates();
        const integralGroup = builder.addGroup("integral", "Integral");

        integralGroup.addItem("integral-register-python-script", {
          icon: SNIPPET_ICON,
          label: "Python Script を登録",
          onRun: () => {
            window.dispatchEvent(new CustomEvent(OPEN_PYTHON_SCRIPT_DIALOG_EVENT));
          }
        });

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
  return getAvailableIntegralBlockTypes()
    .map((definition) => toIntegralSnippetTemplate(definition))
    .sort((left, right) => left.label.localeCompare(right.label, "ja"));
}

function toIntegralSnippetTemplate(
  definition: IntegralBlockTypeDefinition
): IntegralSnippetTemplate {
  return {
    key: `integral-${toSnippetKeySegment(`${definition.pluginId}-${definition.blockType}`)}`,
    label:
      definition.pluginId === "general-analysis"
        ? `${definition.title} [Python]`
        : definition.title,
    markdown: toIntegralCodeBlock(createInitialIntegralBlock(definition))
  };
}

function toSnippetKeySegment(type: string): string {
  const normalized = type.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  const trimmed = normalized.replace(/^-+/u, "").replace(/-+$/u, "");

  return trimmed.length > 0 ? trimmed : "block";
}


