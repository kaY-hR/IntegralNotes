import type {
  IntegralBlockDocument,
  IntegralBlockOutputConfig,
  IntegralBlockTypeDefinition
} from "../shared/integral";
import {
  createDefaultIntegralBlockOutputConfig,
  normalizeIntegralBlockOutputConfig
} from "../shared/integral";

import { getInstalledIntegralBlockDefinition } from "./integralPluginRuntime";
import {
  parseSimpleYamlDocument,
  serializeSimpleYamlDocument,
  type SimpleYamlObject,
  type SimpleYamlValue
} from "./simpleYaml";

export const INTEGRAL_BLOCK_LANGUAGE = "itg-notes";
export const GENERAL_ANALYSIS_PLUGIN_ID = "general-analysis";

export interface IntegralJsonBlock extends IntegralBlockDocument {}

export interface ParsedIntegralBlockSource {
  block: IntegralJsonBlock;
}

export type IntegralBlockDefinition = IntegralBlockTypeDefinition;

export function getIntegralBlockDefinition(
  pluginId: string,
  blockType: string
): IntegralBlockDefinition | null {
  const exactMatch = getInstalledIntegralBlockDefinition(pluginId, blockType);

  if (exactMatch !== null) {
    return exactMatch;
  }

  return null;
}

export function isIntegralBlockLanguage(language: string): boolean {
  return language.trim().toLowerCase() === INTEGRAL_BLOCK_LANGUAGE;
}

export function parseIntegralBlockSource(
  language: string,
  content: string
): ParsedIntegralBlockSource | null {
  if (!isIntegralBlockLanguage(language)) {
    return null;
  }

  return parseIntegralYamlSource(content);
}

export function createInitialIntegralBlock(
  definition: IntegralBlockDefinition
): IntegralJsonBlock {
  return {
    "block-type": definition.blockType,
    id: createBlockId(),
    inputs: Object.fromEntries(definition.inputSlots.map((slot) => [slot.name, null])),
    outputs: Object.fromEntries(definition.outputSlots.map((slot) => [slot.name, null])),
    outputConfigs: Object.fromEntries(
      definition.outputSlots.map((slot) => [slot.name, createDefaultIntegralBlockOutputConfig(slot.name)])
    ),
    params: {},
    plugin: definition.pluginId
  };
}

export function createIntegralBlockMarkdown(definition: IntegralBlockDefinition): string {
  return toIntegralCodeBlock(serializeIntegralBlockContent(createInitialIntegralBlock(definition)));
}

export function serializeIntegralBlockContent(block: IntegralBlockDocument): string {
  return serializeSimpleYamlDocument(buildIntegralYamlDocument(block));
}

export function toIntegralCodeBlock(content: string): string {
  return [`\`\`\`${INTEGRAL_BLOCK_LANGUAGE}`, content, "```"].join("\n");
}

export function renderIntegralBlockBody(block: IntegralJsonBlock): JSX.Element {
  const inputEntries = Object.entries(block.inputs);
  const outputEntries = Object.entries(block.outputs);

  return (
    <>
      <div className="integral-json-preview__stats">
        <StatCard label="Plugin" value={block.plugin} />
        <StatCard label="Inputs" value={`${inputEntries.length}`} />
        <StatCard label="Outputs" value={`${outputEntries.length}`} />
      </div>

      <section className="integral-json-preview__section">
        <div className="integral-json-preview__section-header">
          <span>Input Slots</span>
          <span>{inputEntries.length > 0 ? "dataset refs" : "empty"}</span>
        </div>

        <div className="integral-json-preview__chips">
          {inputEntries.length > 0 ? (
            inputEntries.map(([slotName, datasetRef]) => (
              <span className="integral-json-preview__chip" key={`input-${slotName}`}>
                {slotName}: {datasetRef ?? "null"}
              </span>
            ))
          ) : (
            <span className="integral-json-preview__empty-chip">input なし</span>
          )}
        </div>
      </section>

      <section className="integral-json-preview__section">
        <div className="integral-json-preview__section-header">
          <span>Output Slots</span>
          <span>{outputEntries.length > 0 ? "latest datasets" : "empty"}</span>
        </div>

        <div className="integral-json-preview__chips">
          {outputEntries.length > 0 ? (
            outputEntries.map(([slotName, datasetId]) => (
              <span className="integral-json-preview__chip" key={`output-${slotName}`}>
                {slotName}: {datasetId ?? "auto"}
              </span>
            ))
          ) : (
            <span className="integral-json-preview__empty-chip">output なし</span>
          )}
        </div>
      </section>
    </>
  );
}

function parseIntegralYamlSource(content: string): ParsedIntegralBlockSource | null {
  try {
    const parsed = parseSimpleYamlDocument(content);

    if (!isJsonRecord(parsed)) {
      return null;
    }

    const run = readOptionalString(parsed.run);
    const use = readOptionalString(parsed.use);
    let plugin = readOptionalString(parsed.plugin);
    let blockType = readOptionalString(parsed["block-type"]);

    if (run) {
      plugin = GENERAL_ANALYSIS_PLUGIN_ID;
      blockType = run;
    } else if (use) {
      const normalizedUse = splitPluginUse(use);

      if (!normalizedUse) {
        return null;
      }

      plugin = normalizedUse.pluginId;
      blockType = normalizedUse.blockType;
    }

    if (!plugin || !blockType) {
      return null;
    }

    const normalizedOutputSection = normalizeOutputSection(parsed.out ?? parsed.outputs);

    return {
      block: {
        "block-type": blockType,
        id: readOptionalString(parsed.id) ?? undefined,
        inputs: normalizeInputMap(parsed.in ?? parsed.inputs),
        outputs: normalizedOutputSection.outputs,
        outputConfigs: normalizedOutputSection.outputConfigs,
        params: isJsonRecord(parsed.params) ? parsed.params : {},
        plugin
      }
    };
  } catch {
    return null;
  }
}

function buildIntegralYamlDocument(block: IntegralBlockDocument): SimpleYamlObject {
  const document: SimpleYamlObject = {
    id: block.id ?? createBlockId()
  };

  if (block.plugin === GENERAL_ANALYSIS_PLUGIN_ID) {
    document.run = block["block-type"];
  } else {
    document.use = `${block.plugin}/${block["block-type"]}`;
  }

  document.in = Object.fromEntries(
    Object.entries(block.inputs).map(([slotName, datasetRef]) => [slotName, datasetRef])
  );
  document.params = block.params;
  document.out = buildOutputYamlMap(block);

  return document;
}

function splitPluginUse(
  value: string
): {
  blockType: string;
  pluginId: string;
} | null {
  const separatorIndex = value.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }

  return {
    blockType: value.slice(separatorIndex + 1).trim(),
    pluginId: value.slice(0, separatorIndex).trim()
  };
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="integral-json-preview__stat">
      <span className="integral-json-preview__stat-label">{label}</span>
      <strong className="integral-json-preview__stat-value">{value}</strong>
    </div>
  );
}

function normalizeInputMap(value: unknown): Record<string, string | null> {
  if (!isJsonRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [
      key,
      typeof candidate === "string" && candidate.trim().length > 0
        ? candidate.trim()
        : candidate === null
          ? null
          : `${candidate}`.trim().length > 0
            ? `${candidate}`.trim()
            : null
    ])
  );
}

function normalizeOutputSection(value: unknown): {
  outputConfigs: Record<string, IntegralBlockOutputConfig | null>;
  outputs: Record<string, string | null>;
} {
  if (!isJsonRecord(value)) {
    return {
      outputConfigs: {},
      outputs: {}
    };
  }

  const outputs: Record<string, string | null> = {};
  const outputConfigs: Record<string, IntegralBlockOutputConfig | null> = {};

  for (const [slotName, candidate] of Object.entries(value)) {
    if (isJsonRecord(candidate)) {
      outputs[slotName] = normalizeOutputLatestReference(candidate.latest);
      outputConfigs[slotName] = normalizeIntegralBlockOutputConfig(
        {
          directory: readOptionalStringAllowEmpty(candidate.dir ?? candidate.directory) ?? undefined,
          name: readOptionalStringAllowEmpty(candidate.name) ?? undefined
        },
        slotName,
        outputs[slotName]
      );
      continue;
    }

    outputs[slotName] = normalizeOutputLatestReference(candidate);
    outputConfigs[slotName] = null;
  }

  return {
    outputConfigs,
    outputs
  };
}

function buildOutputYamlMap(block: IntegralBlockDocument): SimpleYamlObject {
  return Object.fromEntries(
    Object.entries(block.outputs).map(([slotName, datasetRef]) => {
      const outputConfig = block.outputConfigs?.[slotName] ?? null;

      if (!outputConfig && datasetRef === null) {
        return [slotName, "auto"];
      }

      const outputEntry: SimpleYamlObject = {};

      if (outputConfig) {
        outputEntry.dir = outputConfig.directory;
        outputEntry.name = outputConfig.name;
      }

      if (datasetRef !== null) {
        outputEntry.latest = datasetRef;
      }

      return [slotName, Object.keys(outputEntry).length > 0 ? outputEntry : "auto"];
    })
  );
}

function normalizeOutputLatestReference(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "auto"
      ? null
      : value.trim().length > 0
        ? value.trim()
        : null;
  }

  if (value === null) {
    return null;
  }

  const serialized = `${value}`.trim();
  return serialized.toLowerCase() === "auto" ? null : serialized.length > 0 ? serialized : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalStringAllowEmpty(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function createBlockId(): string {
  return `BLK-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
