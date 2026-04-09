import { getInstalledIntegralBlockDefinition } from "./integralPluginRuntime";

interface JsonRecord {
  [key: string]: unknown;
}

export const INTEGRAL_BLOCK_LANGUAGE = "itg-notes";

export interface IntegralJsonBlock extends JsonRecord {
  params?: JsonRecord;
  type: string;
}

export interface IntegralBlockActionDefinition {
  busyLabel: string;
  id: string;
  label: string;
}

export interface IntegralBlockDefinition {
  actions?: IntegralBlockActionDefinition[];
  description: string;
  hasRenderer: boolean;
  pluginDescription: string;
  pluginDisplayName: string;
  pluginId: string;
  pluginNamespace: string;
  pluginOrigin: "external";
  pluginVersion: string;
  title: string;
  type: string;
}

export function getIntegralBlockDefinition(type: string): IntegralBlockDefinition | null {
  return getInstalledIntegralBlockDefinition(type);
}

export function isIntegralBlockLanguage(language: string): boolean {
  return language.trim().toLowerCase() === INTEGRAL_BLOCK_LANGUAGE;
}

export function parseIntegralJsonBlock(language: string, content: string): IntegralJsonBlock | null {
  if (!isIntegralBlockLanguage(language)) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);

    if (!isJsonRecord(parsed)) {
      return null;
    }

    const type = parsed.type;

    if (typeof type !== "string" || type.trim().length === 0) {
      return null;
    }

    const params = isJsonRecord(parsed.params) ? parsed.params : undefined;

    return {
      ...parsed,
      params,
      type
    };
  } catch {
    return null;
  }
}

export function renderIntegralBlockBody(block: IntegralJsonBlock): JSX.Element {
  return <GenericBlockBody block={block} />;
}

function GenericBlockBody({ block }: { block: IntegralJsonBlock }): JSX.Element {
  const params = block.params ?? {};
  const paramKeys = Object.keys(params);
  const typeSegments = block.type.split(".");

  return (
    <>
      <div className="integral-json-preview__stats">
        <StatCard label="Type" value={typeSegments[typeSegments.length - 1] ?? block.type} />
        <StatCard label="Params" value={`${paramKeys.length}`} />
        <StatCard label="State" value="Fallback" />
      </div>

      <section className="integral-json-preview__section">
        <div className="integral-json-preview__section-header">
          <span>Registered Keys</span>
          <span>{paramKeys.length > 0 ? "generic preview" : "empty"}</span>
        </div>

        <div className="integral-json-preview__chips">
          {paramKeys.length > 0 ? (
            paramKeys.map((key) => (
              <span className="integral-json-preview__chip" key={key}>
                {key}
              </span>
            ))
          ) : (
            <span className="integral-json-preview__empty-chip">params なし</span>
          )}
        </div>
      </section>

      <p className="integral-json-preview__note">
        plugin renderer が未登録または読込失敗のため、汎用 preview を表示しています。
      </p>
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

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
