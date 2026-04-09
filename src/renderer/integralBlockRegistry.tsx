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
  action?: IntegralBlockActionDefinition;
  description: string;
  title: string;
}

interface GradientPoint {
  concentration: number;
  time: number;
}

const CHROMATOGRAM_TRACE_PATHS = [
  "M8 86 C22 86 26 86 30 74 S42 22 48 22 S58 84 66 84 S78 36 86 36 S98 78 110 78 S122 44 132 44 S146 74 156 74 S170 24 182 24 S198 84 232 84",
  "M8 84 C22 84 26 84 32 58 S46 18 54 18 S66 80 74 80 S88 42 98 42 S112 70 124 70 S140 28 152 28 S170 64 184 64 S202 36 232 36",
  "M8 82 C22 82 26 82 34 66 S48 34 56 34 S68 74 78 74 S92 52 102 52 S118 80 128 80 S146 48 160 48 S178 70 194 70 S212 26 232 26",
  "M8 88 C22 88 26 88 34 72 S48 48 58 48 S72 86 84 86 S98 24 108 24 S122 68 136 68 S154 18 166 18 S186 74 198 74 S214 54 232 54"
] as const;

const INTEGRAL_BLOCK_DEFINITIONS: Readonly<Record<string, IntegralBlockDefinition>> = {
  "LC.Method.Gradient": {
    action: {
      busyLabel: "装置操作を送信中...",
      id: "execute",
      label: "装置操作を実行"
    },
    description: "勾配プログラムを可視化し、実行要求を main process へ渡します。",
    title: "LC Gradient"
  },
  "StandardGraphs.Chromatogram": {
    action: {
      busyLabel: "解析ジョブを起動中...",
      id: "analyze",
      label: "解析を実行"
    },
    description: "対象データを確認し、クロマトグラム解析要求を main process へ渡します。",
    title: "Chromatogram"
  }
};

export function getIntegralBlockDefinition(type: string): IntegralBlockDefinition | null {
  return INTEGRAL_BLOCK_DEFINITIONS[type] ?? null;
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
  switch (block.type) {
    case "LC.Method.Gradient":
      return <GradientBlockBody block={block} />;

    case "StandardGraphs.Chromatogram":
      return <ChromatogramBlockBody block={block} />;

    default:
      return <GenericBlockBody block={block} />;
  }
}

function GradientBlockBody({ block }: { block: IntegralJsonBlock }): JSX.Element {
  const params = block.params ?? {};
  const analysisTime = readFiniteNumber(params["analysis-time"]);
  const points = readGradientPoints(params["time-prog"]);

  return (
    <>
      <div className="integral-json-preview__stats">
        <StatCard label="Analysis" value={analysisTime === undefined ? "-" : `${formatNumber(analysisTime)} min`} />
        <StatCard label="Points" value={`${points.length}`} />
        <StatCard label="Mode" value="Gradient" />
      </div>

      <section className="integral-json-preview__section">
        <div className="integral-json-preview__section-header">
          <span>Program</span>
          <span>{points.length > 0 ? "time / Conc" : "未設定"}</span>
        </div>

        <div className="integral-json-preview__timeline">
          {points.length > 0 ? (
            points.map((point, index) => (
              <div className="integral-json-preview__timeline-row" key={`${point.time}-${point.concentration}`}>
                <span className="integral-json-preview__timeline-step">#{index + 1}</span>
                <span className="integral-json-preview__timeline-time">{formatMinutes(point.time)}</span>
                <div className="integral-json-preview__timeline-track">
                  <span
                    className="integral-json-preview__timeline-fill"
                    style={{ width: `${clamp(point.concentration, 0, 100)}%` }}
                  />
                </div>
                <strong className="integral-json-preview__timeline-value">
                  {formatPercent(point.concentration)}
                </strong>
              </div>
            ))
          ) : (
            <div className="integral-json-preview__empty">
              time-prog が未設定です。JSON 編集から設定してください。
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ChromatogramBlockBody({ block }: { block: IntegralJsonBlock }): JSX.Element {
  const params = block.params ?? {};
  const dataFiles = readStringArray(params.data);
  const traceCount = Math.max(1, Math.min(dataFiles.length || 1, CHROMATOGRAM_TRACE_PATHS.length));
  const tracePaths = CHROMATOGRAM_TRACE_PATHS.slice(0, traceCount);

  return (
    <>
      <div className="integral-json-preview__stats">
        <StatCard label="Series" value={`${dataFiles.length}`} />
        <StatCard label="View" value="Overlay" />
        <StatCard label="Status" value={dataFiles.length > 0 ? "Ready" : "Need data"} />
      </div>

      <section className="integral-json-preview__section">
        <div className="integral-json-preview__section-header">
          <span>Plot Preview</span>
          <span>{dataFiles.length > 0 ? "synthetic trace" : "placeholder"}</span>
        </div>

        <div className="integral-json-preview__plot">
          <svg
            aria-hidden="true"
            className="integral-json-preview__plot-svg"
            viewBox="0 0 240 96"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path className="integral-json-preview__axis" d="M10 8 V88 H232" fill="none" />

            {tracePaths.map((path, index) => (
              <path
                className={`integral-json-preview__trace integral-json-preview__trace--${index}`}
                d={path}
                fill="none"
                key={path}
                pathLength="100"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        </div>
      </section>

      <section className="integral-json-preview__section">
        <div className="integral-json-preview__section-header">
          <span>Datasets</span>
          <span>{dataFiles.length > 0 ? `${dataFiles.length} selected` : "0 selected"}</span>
        </div>

        <div className="integral-json-preview__chips">
          {dataFiles.length > 0 ? (
            dataFiles.map((fileName) => (
              <span className="integral-json-preview__chip" key={fileName}>
                {fileName}
              </span>
            ))
          ) : (
            <span className="integral-json-preview__empty-chip">データファイル未設定</span>
          )}
        </div>
      </section>
    </>
  );
}

function GenericBlockBody({ block }: { block: IntegralJsonBlock }): JSX.Element {
  const params = block.params ?? {};
  const paramKeys = Object.keys(params);

  return (
    <>
      <div className="integral-json-preview__stats">
        <StatCard label="Type" value="Custom" />
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
        専用 renderer を追加すれば、このブロックはより具体的な UI に置き換えられます。
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

function readGradientPoints(value: unknown): GradientPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: GradientPoint[] = [];

  for (const item of value) {
    if (!isJsonRecord(item)) {
      continue;
    }

    const time = readFiniteNumber(item.time);
    const concentration = readFiniteNumber(item.Conc);

    if (time === undefined || concentration === undefined) {
      continue;
    }

    points.push({ time, concentration });
  }

  return points.sort((left, right) => left.time - right.time);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMinutes(value: number): string {
  return `${formatNumber(value)} min`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value)} %`;
}

function formatNumber(value: number): string {
  const normalized = Number.isInteger(value) ? value.toString() : value.toFixed(2);

  return normalized.replace(/\.?0+$/, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
