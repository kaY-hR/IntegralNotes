import type {
  InstalledPluginOrigin,
  PluginActionContribution,
  ResolvedPluginViewer
} from "./plugins";

export interface IntegralSlotDefinition {
  autoInsertToWorkNote?: boolean;
  datatype?: string;
  embedToSharedNote?: boolean;
  extension?: string;
  extensions?: string[];
  name: string;
  shareNoteWithInput?: string;
}

export type IntegralParamPrimitiveType = "boolean" | "integer" | "number" | "string";

export type IntegralParamValue = boolean | number | string | null;

export interface IntegralParamSchemaProperty {
  default?: IntegralParamValue;
  description?: string;
  enum?: IntegralParamValue[];
  maximum?: number;
  minimum?: number;
  title?: string;
  type: IntegralParamPrimitiveType;
}

export interface IntegralParamsSchema {
  properties: Record<string, IntegralParamSchemaProperty>;
  type: "object";
}

export interface IntegralExternalPluginDefinition {
  actions?: PluginActionContribution[];
  namespace: string;
  origin: InstalledPluginOrigin;
  rendererMode?: "iframe";
  runtimeBlockType: string;
  runtimePluginId: string;
  version: string;
}

export interface IntegralBlockDocument extends Record<string, unknown> {
  "block-type": string;
  id?: string;
  inputs: Record<string, string | null>;
  outputs: Record<string, string | null>;
  params: Record<string, unknown>;
  plugin: string;
}

export interface IntegralBlockTypeDefinition {
  blockType: string;
  description: string;
  externalPlugin?: IntegralExternalPluginDefinition;
  executionMode: "display" | "manual";
  inputSlots: IntegralSlotDefinition[];
  outputSlots: IntegralSlotDefinition[];
  paramsSchema?: IntegralParamsSchema;
  pluginDescription: string;
  pluginDisplayName: string;
  pluginId: string;
  source: "builtin" | "external-plugin" | "python-callable";
  title: string;
}

export type IntegralManagedDataVisibility = "visible" | "hidden";
export type IntegralManagedDataEntityType = "managed-file" | "dataset";
export type IntegralManagedDataTrackingIssueKind = "missing" | "relink";
export type IntegralManagedFileContentRepresentation = "directory" | "file";
export type IntegralDatasetRepresentation = "dataset-json";
export type IntegralManagedFileRepresentation =
  | IntegralManagedFileContentRepresentation
  | IntegralDatasetRepresentation;

export interface IntegralManagedFileSummary {
  createdAt: string;
  canOpenDataNote: boolean;
  createdByBlockId: string | null;
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  datatype: string | null;
  hash: string;
  id: string;
  noteTargetId?: string;
  path: string;
  representation: IntegralManagedFileRepresentation;
  visibility: IntegralManagedDataVisibility;
}

export interface IntegralDatasetSummary {
  canOpenDataNote: boolean;
  createdAt: string;
  createdByBlockId: string | null;
  datatype: string | null;
  datasetId: string;
  hash: string;
  hasRenderableFiles: boolean;
  memberIds?: string[];
  name: string;
  noteTargetId?: string;
  path: string;
  representation: IntegralDatasetRepresentation;
  renderableCount: number;
  visibility: IntegralManagedDataVisibility;
}

export interface IntegralRenderableFile {
  data: string;
  kind: "html" | "image" | "plugin" | "text";
  name: string;
  pluginViewer?: ResolvedPluginViewer;
  relativePath: string;
}

export interface IntegralDatasetInspection extends IntegralDatasetSummary {
  fileNames: string[];
  renderables: IntegralRenderableFile[];
}

export interface IntegralAssetCatalog {
  datasets: IntegralDatasetSummary[];
  blockTypes: IntegralBlockTypeDefinition[];
  managedFiles: IntegralManagedFileSummary[];
}

export interface IntegralManagedDataTrackingIssue {
  candidatePaths: string[];
  displayName: string;
  entityType: IntegralManagedDataEntityType;
  kind: IntegralManagedDataTrackingIssueKind;
  recordedHash: string;
  recordedPath: string;
  representation: IntegralManagedFileRepresentation;
  targetId: string;
}

export interface ResolveIntegralManagedDataTrackingIssueRequest {
  action: "remove" | "relink";
  entityType: IntegralManagedDataEntityType;
  selectedPath?: string;
  targetId: string;
}

export interface ImportManagedFilesResult {
  managedFiles: IntegralManagedFileSummary[];
}

export interface CreateDatasetRequest {
  managedFileIds: string[];
  name?: string;
}

export interface CreateDatasetFromWorkspaceEntriesRequest {
  name?: string;
  relativePaths: string[];
}

export interface CreateDatasetResult {
  dataset: IntegralDatasetSummary;
}

export interface ExecuteIntegralBlockRequest {
  block: IntegralBlockDocument;
  sourceNotePath?: string | null;
}

export interface ExecuteIntegralBlockResult {
  block: IntegralBlockDocument;
  createdDatasets: IntegralDatasetSummary[];
  finishedAt: string;
  logLines: string[];
  startedAt: string;
  status: "success";
  summary: string;
  workNoteMarkdownToAppend: string | null;
}

const DEFAULT_OUTPUT_DIRECTORY = "/Data";
const OUTPUT_PATH_SUFFIX_BASE = 36 ** 3;

export function normalizeIntegralSlotExtension(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function normalizeIntegralSlotExtensions(
  values: readonly string[] | null | undefined
): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => normalizeIntegralSlotExtension(value))
        .filter((value): value is string => value !== null)
    )
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function getIntegralSlotPrimaryExtension(
  slot: Pick<IntegralSlotDefinition, "extension" | "extensions">,
  fallback: string | null = null
): string | null {
  const direct = normalizeIntegralSlotExtension(slot.extension);

  if (direct) {
    return direct;
  }

  const listed = normalizeIntegralSlotExtensions(slot.extensions)?.[0] ?? null;
  return listed ?? normalizeIntegralSlotExtension(fallback);
}

export function isIntegralBundleExtension(value: string | null | undefined): boolean {
  return normalizeIntegralSlotExtension(value) === ".idts";
}

export function createIntegralOutputPathRandomSuffix(): string {
  return Math.floor(Math.random() * OUTPUT_PATH_SUFFIX_BASE)
    .toString(36)
    .padStart(3, "0")
    .toUpperCase();
}

export function createDefaultIntegralOutputPath(
  slot: IntegralSlotDefinition,
  suffix = ""
): string {
  const extension = getIntegralSlotPrimaryExtension(slot, ".idts") ?? ".idts";
  const stem = slot.name.trim().length > 0 ? slot.name.trim() : "output";
  const normalizedSuffix = suffix.trim().replace(/^_+/u, "");
  const suffixSegment = normalizedSuffix.length > 0 ? `_${normalizedSuffix}` : "";
  return `${DEFAULT_OUTPUT_DIRECTORY}/${stem}${suffixSegment}${extension}`;
}

export function createDefaultIntegralOutputPathWithRandomSuffix(
  slot: IntegralSlotDefinition
): string {
  return createDefaultIntegralOutputPath(slot, createIntegralOutputPathRandomSuffix());
}

export function normalizeIntegralParamsSchema(value: unknown): IntegralParamsSchema | undefined {
  if (!isIntegralRecord(value) || value.type !== "object" || !isIntegralRecord(value.properties)) {
    return undefined;
  }

  const properties: Record<string, IntegralParamSchemaProperty> = {};

  for (const [rawName, rawProperty] of Object.entries(value.properties)) {
    const name = rawName.trim();

    if (name.length === 0 || !isIntegralRecord(rawProperty)) {
      continue;
    }

    const type = normalizeIntegralParamPrimitiveType(rawProperty.type);

    if (!type) {
      continue;
    }

    const property: IntegralParamSchemaProperty = {
      type
    };
    const title = normalizeOptionalIntegralString(rawProperty.title);
    const description = normalizeOptionalIntegralString(rawProperty.description);
    const defaultValue = normalizeIntegralParamValue(rawProperty.default, type, rawProperty);
    const enumValues = normalizeIntegralParamEnum(rawProperty.enum, type, rawProperty);

    if (title !== undefined) {
      property.title = title;
    }

    if (description !== undefined) {
      property.description = description;
    }

    if (Object.prototype.hasOwnProperty.call(rawProperty, "default")) {
      property.default = defaultValue ?? null;
    }

    if (enumValues !== undefined) {
      property.enum = enumValues;
    }

    if (type === "integer" || type === "number") {
      const minimum = normalizeIntegralParamNumberConstraint(rawProperty.minimum);
      const maximum = normalizeIntegralParamNumberConstraint(rawProperty.maximum);

      if (minimum !== undefined) {
        property.minimum = minimum;
      }

      if (maximum !== undefined) {
        property.maximum = maximum;
      }
    }

    properties[name] = property;
  }

  return Object.keys(properties).length > 0
    ? {
        properties,
        type: "object"
      }
    : undefined;
}

export function createDefaultIntegralParams(
  paramsSchema: IntegralParamsSchema | null | undefined
): Record<string, unknown> {
  if (!paramsSchema) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(paramsSchema.properties).map(([name, property]) => [
      name,
      Object.prototype.hasOwnProperty.call(property, "default") ? property.default ?? null : null
    ])
  );
}

export function normalizeIntegralParams(
  currentParams: Record<string, unknown> | null | undefined,
  paramsSchema: IntegralParamsSchema | null | undefined
): Record<string, unknown> {
  if (!paramsSchema) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(paramsSchema.properties).map(([name, property]) => {
      const currentValue = currentParams?.[name];

      if (isIntegralParamValueAllowed(currentValue, property)) {
        return [name, currentValue];
      }

      return [
        name,
        Object.prototype.hasOwnProperty.call(property, "default") ? property.default ?? null : null
      ];
    })
  );
}

function normalizeIntegralParamPrimitiveType(value: unknown): IntegralParamPrimitiveType | null {
  return value === "boolean" || value === "integer" || value === "number" || value === "string"
    ? value
    : null;
}

function normalizeOptionalIntegralString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIntegralParamValue(
  value: unknown,
  type: IntegralParamPrimitiveType,
  property: Record<string, unknown>
): IntegralParamValue | undefined {
  if (isIntegralParamValueForType(value, type)) {
    if (!isIntegralParamNumberInRange(value, property)) {
      return undefined;
    }

    return value;
  }

  return undefined;
}

function normalizeIntegralParamEnum(
  value: unknown,
  type: IntegralParamPrimitiveType,
  property: Record<string, unknown>
): IntegralParamValue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.filter((item): item is IntegralParamValue => {
    return (
      isIntegralParamValueForType(item, type) &&
      isIntegralParamNumberInRange(item, property)
    );
  });

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIntegralParamNumberConstraint(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isIntegralParamValueAllowed(
  value: unknown,
  property: IntegralParamSchemaProperty
): value is IntegralParamValue {
  if (value === null) {
    return true;
  }

  if (!isIntegralParamValueForType(value, property.type)) {
    return false;
  }

  if (!isIntegralParamNumberInRange(value, property)) {
    return false;
  }

  if (property.enum && !property.enum.some((item) => item === value)) {
    return false;
  }

  return true;
}

function isIntegralParamValueForType(
  value: unknown,
  type: IntegralParamPrimitiveType
): value is IntegralParamValue {
  if (type === "boolean") {
    return typeof value === "boolean";
  }

  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }

  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }

  return typeof value === "string";
}

function isIntegralParamNumberInRange(
  value: unknown,
  property: Pick<IntegralParamSchemaProperty, "maximum" | "minimum">
): boolean {
  if (typeof value !== "number") {
    return true;
  }

  if (typeof property.minimum === "number" && value < property.minimum) {
    return false;
  }

  if (typeof property.maximum === "number" && value > property.maximum) {
    return false;
  }

  return true;
}

function isIntegralRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
