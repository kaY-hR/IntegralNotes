interface JsonRecord {
  [key: string]: unknown;
}

interface IntegralJsonBlock extends JsonRecord {
  params?: JsonRecord;
  type: string;
}

interface GradientPoint {
  concentration: number;
  time: number;
}

interface IntegralPreviewRenderer {
  description: string;
  renderBody: (block: IntegralJsonBlock) => string;
  title: string;
}

const CHROMATOGRAM_TRACE_PATHS = [
  "M8 86 C22 86 26 86 30 74 S42 22 48 22 S58 84 66 84 S78 36 86 36 S98 78 110 78 S122 44 132 44 S146 74 156 74 S170 24 182 24 S198 84 232 84",
  "M8 84 C22 84 26 84 32 58 S46 18 54 18 S66 80 74 80 S88 42 98 42 S112 70 124 70 S140 28 152 28 S170 64 184 64 S202 36 232 36",
  "M8 82 C22 82 26 82 34 66 S48 34 56 34 S68 74 78 74 S92 52 102 52 S118 80 128 80 S146 48 160 48 S178 70 194 70 S212 26 232 26",
  "M8 88 C22 88 26 88 34 72 S48 48 58 48 S72 86 84 86 S98 24 108 24 S122 68 136 68 S154 18 166 18 S186 74 198 74 S214 54 232 54"
] as const;

const INTEGRAL_PREVIEW_RENDERERS: Readonly<Record<string, IntegralPreviewRenderer>> = {
  "LC.Method.Gradient": {
    title: "LC Gradient",
    description: "time-prog を読み取り、勾配プログラムを簡易 UI として表示します。",
    renderBody: renderGradientBody
  },
  "StandardGraphs.Chromatogram": {
    title: "Chromatogram",
    description: "対象データを読み取り、クロマトグラム表示の仮 UI を返します。",
    renderBody: renderChromatogramBody
  }
};

export function renderIntegralJsonCodeBlockPreview(language: string, content: string): string | null {
  if (language.trim().toLowerCase() !== "json") {
    return null;
  }

  const parsedBlock = parseIntegralJsonBlock(content);

  if (!parsedBlock) {
    return null;
  }

  const renderer = INTEGRAL_PREVIEW_RENDERERS[parsedBlock.type];

  if (renderer) {
    return renderPreviewCard(parsedBlock, renderer.title, renderer.description, renderer.renderBody(parsedBlock));
  }

  return renderPreviewCard(
    parsedBlock,
    parsedBlock.type,
    "専用 renderer が未登録のため、汎用プレビューで表示しています。",
    renderGenericBody(parsedBlock)
  );
}

function parseIntegralJsonBlock(content: string): IntegralJsonBlock | null {
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

function renderPreviewCard(
  block: IntegralJsonBlock,
  title: string,
  description: string,
  body: string
): string {
  return `
    <section class="integral-json-preview">
      <div class="integral-json-preview__header">
        <div>
          <p class="integral-json-preview__eyebrow">Integral JSON Block</p>
          <h3 class="integral-json-preview__title">${escapeHtml(title)}</h3>
        </div>
        <code class="integral-json-preview__type">${escapeHtml(block.type)}</code>
      </div>
      <p class="integral-json-preview__description">${escapeHtml(description)}</p>
      ${body}
    </section>
  `.trim();
}

function renderGradientBody(block: IntegralJsonBlock): string {
  const params = block.params ?? {};
  const analysisTime = readFiniteNumber(params["analysis-time"]);
  const points = readGradientPoints(params["time-prog"]);
  const pointRows =
    points.length > 0
      ? points
          .map((point, index) => {
            const normalizedWidth = clamp(point.concentration, 0, 100);

            return `
              <div class="integral-json-preview__timeline-row">
                <span class="integral-json-preview__timeline-step">#${index + 1}</span>
                <span class="integral-json-preview__timeline-time">${escapeHtml(formatMinutes(point.time))}</span>
                <div class="integral-json-preview__timeline-track">
                  <span class="integral-json-preview__timeline-fill" style="width: ${normalizedWidth}%;"></span>
                </div>
                <strong class="integral-json-preview__timeline-value">${escapeHtml(formatPercent(point.concentration))}</strong>
              </div>
            `;
          })
          .join("")
      : `<div class="integral-json-preview__empty">time-prog が未設定です。JSON 編集から設定してください。</div>`;

  return `
    <div class="integral-json-preview__stats">
      ${renderStat("Analysis", analysisTime === undefined ? "-" : `${formatNumber(analysisTime)} min`)}
      ${renderStat("Points", `${points.length}`)}
      ${renderStat("Mode", "Gradient")}
    </div>
    <div class="integral-json-preview__section">
      <div class="integral-json-preview__section-header">
        <span>Program</span>
        <span>${escapeHtml(points.length > 0 ? "time / Conc" : "未設定")}</span>
      </div>
      <div class="integral-json-preview__timeline">
        ${pointRows}
      </div>
    </div>
  `.trim();
}

function renderChromatogramBody(block: IntegralJsonBlock): string {
  const params = block.params ?? {};
  const dataFiles = readStringArray(params.data);
  const traceCount = Math.max(1, Math.min(dataFiles.length || 1, CHROMATOGRAM_TRACE_PATHS.length));
  const traces = CHROMATOGRAM_TRACE_PATHS.slice(0, traceCount)
    .map(
      (path, index) => `
        <path
          class="integral-json-preview__trace integral-json-preview__trace--${index % CHROMATOGRAM_TRACE_PATHS.length}"
          d="${path}"
          fill="none"
          pathLength="100"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      `
    )
    .join("");
  const chips =
    dataFiles.length > 0
      ? dataFiles
          .map(
            (fileName) =>
              `<span class="integral-json-preview__chip">${escapeHtml(fileName)}</span>`
          )
          .join("")
      : `<span class="integral-json-preview__empty-chip">データファイル未設定</span>`;

  return `
    <div class="integral-json-preview__stats">
      ${renderStat("Series", `${dataFiles.length}`)}
      ${renderStat("View", "Overlay")}
      ${renderStat("Status", dataFiles.length > 0 ? "Ready" : "Need data")}
    </div>
    <div class="integral-json-preview__section">
      <div class="integral-json-preview__section-header">
        <span>Plot Preview</span>
        <span>${escapeHtml(dataFiles.length > 0 ? "synthetic trace" : "placeholder")}</span>
      </div>
      <div class="integral-json-preview__plot">
        <svg
          aria-hidden="true"
          class="integral-json-preview__plot-svg"
          viewBox="0 0 240 96"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path class="integral-json-preview__axis" d="M10 8 V88 H232" fill="none" />
          ${traces}
        </svg>
      </div>
    </div>
    <div class="integral-json-preview__section">
      <div class="integral-json-preview__section-header">
        <span>Datasets</span>
        <span>${escapeHtml(dataFiles.length > 0 ? `${dataFiles.length} selected` : "0 selected")}</span>
      </div>
      <div class="integral-json-preview__chips">${chips}</div>
    </div>
  `.trim();
}

function renderGenericBody(block: IntegralJsonBlock): string {
  const params = block.params ?? {};
  const paramKeys = Object.keys(params);
  const chips =
    paramKeys.length > 0
      ? paramKeys
          .map((key) => `<span class="integral-json-preview__chip">${escapeHtml(key)}</span>`)
          .join("")
      : `<span class="integral-json-preview__empty-chip">params なし</span>`;

  return `
    <div class="integral-json-preview__stats">
      ${renderStat("Type", "Custom")}
      ${renderStat("Params", `${paramKeys.length}`)}
      ${renderStat("State", "Fallback")}
    </div>
    <div class="integral-json-preview__section">
      <div class="integral-json-preview__section-header">
        <span>Registered Keys</span>
        <span>${escapeHtml(paramKeys.length > 0 ? "generic preview" : "empty")}</span>
      </div>
      <div class="integral-json-preview__chips">${chips}</div>
    </div>
    <div class="integral-json-preview__note">
      専用 renderer を追加すれば、このブロックはより具体的な UI に置き換えられます。
    </div>
  `.trim();
}

function renderStat(label: string, value: string): string {
  return `
    <div class="integral-json-preview__stat">
      <span class="integral-json-preview__stat-label">${escapeHtml(label)}</span>
      <strong class="integral-json-preview__stat-value">${escapeHtml(value)}</strong>
    </div>
  `.trim();
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
