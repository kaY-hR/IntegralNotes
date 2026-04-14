import type {
  IntegralBlockDocument,
  IntegralBlockTypeDefinition
} from "../shared/integral";

import { getInstalledIntegralBlockDefinition } from "./integralPluginRuntime";

export const INTEGRAL_BLOCK_LANGUAGE = "itg-notes";

export interface IntegralJsonBlock extends IntegralBlockDocument {}

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

export function parseIntegralJsonBlock(
  language: string,
  content: string
): IntegralJsonBlock | null {
  if (!isIntegralBlockLanguage(language)) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);

    if (!isJsonRecord(parsed)) {
      return null;
    }

    const plugin = readRequiredString(parsed.plugin);
    const blockType = readRequiredString(parsed["block-type"]);

    if (plugin === null || blockType === null) {
      return null;
    }

    return {
      "block-type": blockType,
      id: readOptionalString(parsed.id) ?? undefined,
      inputs: normalizeSlotMap(parsed.inputs),
      outputs: normalizeSlotMap(parsed.outputs),
      params: isJsonRecord(parsed.params) ? parsed.params : {},
      plugin
    };
  } catch {
    return null;
  }
}

export function createInitialIntegralBlock(
  definition: IntegralBlockDefinition
): IntegralJsonBlock {
  return {
    "block-type": definition.blockType,
    id: createBlockId(),
    inputs: Object.fromEntries(definition.inputSlots.map((slot) => [slot.name, null])),
    outputs: Object.fromEntries(definition.outputSlots.map((slot) => [slot.name, null])),
    params: {},
    plugin: definition.pluginId
  };
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
            inputEntries.map(([slotName, datasetId]) => (
              <span className="integral-json-preview__chip" key={`input-${slotName}`}>
                {slotName}: {datasetId ?? "null"}
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
                {slotName}: {datasetId ?? "null"}
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

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="integral-json-preview__stat">
      <span className="integral-json-preview__stat-label">{label}</span>
      <strong className="integral-json-preview__stat-value">{value}</strong>
    </div>
  );
}

function normalizeSlotMap(value: unknown): Record<string, string | null> {
  if (!isJsonRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [
      key,
      typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null
    ])
  );
}

function readRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createBlockId(): string {
  return `BLK-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


