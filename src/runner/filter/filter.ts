/**
 * Run-time filters per V1_BUILD_SPEC.md §9 lines 628–635 plus the §3 / §7
 * prod-safety contract (line 433 — write-method smoke tests are skipped in
 * `prod: true` environments unless the endpoint declared `prod_safe: true`).
 *
 * Combines six filter dimensions, all AND-ed together:
 *  - `markers`: smoke / regression / e2e / all (or list).
 *  - `path`: directory subtree filter.
 *  - `tag`: endpoint tag filter (orthogonal to directory).
 *  - `endpoint`: single endpoint id.
 *  - `excludeTags`: exclude endpoints carrying any of these tags.
 *  - `prodEnv` (per-run context, NOT a user filter): when `true`, drops every
 *    case with `case.prod_safe === false`. The §3 `ProdSafetyClassifier`
 *    stamps every generated `TestCase` with a `prod_safe` flag — this filter
 *    is the runtime enforcement boundary the catalog explicitly defers to
 *    (`prod-safety-classifier.ts` docstring: "Does not enforce skipping —
 *    that is the runner's responsibility").
 *
 * Pure + deterministic + total: a single function `applyFilters` takes the
 * full set of {@link PlannedTestCase}s + the {@link EndpointLoadRecord}
 * lookup + the {@link RunFilters} + the `prodEnv` flag and returns the
 * filtered subset in the SAME order it received them (sort is the sharder's
 * responsibility).
 */

import type { TestMarker } from "../../core/canonical-model.js";
import { expandMarkerSelection } from "../../test-catalog/index.js";
import type {
  EndpointLoadRecord,
  PlannedTestCase,
  RunFilters,
} from "../types.js";

/**
 * Filters the planned cases by every dimension present on `filters` AND the
 * prod-safety contract. AND-combined: a case must pass every present
 * dimension AND the prod-safety check to be included.
 * @param cases - The full planned cases list from {@link generateTestPlan}.
 * @param endpoints - The endpoint lookup map (carries tags + path).
 * @param filters - The {@link RunFilters} snapshot.
 * @param prodEnv - True iff the resolved environment is flagged `prod: true`.
 *   When `true`, cases with `case.prod_safe === false` are dropped (audit
 *   blocker 🚨-1 / V1_BUILD_SPEC.md §3 line 433). When `false` (default),
 *   the prod-safety check is a no-op.
 * @returns The subset of `cases` that pass every filter dimension; order
 *   preserved exactly as received.
 */
export function applyFilters(
  cases: readonly PlannedTestCase[],
  endpoints: ReadonlyMap<string, EndpointLoadRecord>,
  filters: RunFilters,
  prodEnv = false,
): readonly PlannedTestCase[] {
  const markerSelectors = filters.markers ?? ["smoke"];
  const expandedMarkers = expandMarkerSelection(
    markerSelectors as Parameters<typeof expandMarkerSelection>[0],
  );
  const markerSet = new Set<TestMarker>(expandedMarkers);

  return cases.filter((c) => {
    const record = endpoints.get(c.endpoint_id);
    if (!record) return false;
    if (!markerSet.has(c.case.marker)) return false;
    if (!passesProdSafety(c, prodEnv)) return false;
    if (!matchesPath(record.path, filters.path)) return false;
    if (!matchesTag(record.endpoint.tags, filters.tag)) return false;
    if (!matchesEndpoint(c.endpoint_id, filters.endpoint)) return false;
    if (!passesExcludeTags(record.endpoint.tags, filters.excludeTags)) return false;
    return true;
  });
}

/**
 * Prod-safety filter — case INCLUDED iff:
 * - the env is NOT prod (filter is a no-op in dev/staging/qa), OR
 * - the case carries `prod_safe: true`.
 *
 * Per V1_BUILD_SPEC.md §3 line 433: "By default, smoke tests for write
 * methods are skipped in environments flagged `prod: true` unless
 * `prod_safe: true` is set on the endpoint." The §3 `ProdSafetyClassifier`
 * resolves the per-case flag at catalog-generation time; this filter is
 * the runtime enforcement.
 * @param c - The planned case (carries `c.case.prod_safe`).
 * @param prodEnv - True iff env.prod is true.
 * @returns True iff the case may run in this environment.
 */
function passesProdSafety(c: PlannedTestCase, prodEnv: boolean): boolean {
  if (!prodEnv) return true;
  return c.case.prod_safe === true;
}

/**
 * Path filter — case included iff the endpoint's file path starts with the
 * supplied prefix (string-startsWith match, no trailing-slash normalization).
 * Absent / empty filter accepts everything.
 * @param recordPath - The endpoint file's repo-relative path.
 * @param pathPrefix - The optional path prefix from `--path=...`.
 * @returns True iff the endpoint's path starts with the supplied prefix.
 */
function matchesPath(recordPath: string, pathPrefix: string | undefined): boolean {
  if (pathPrefix === undefined || pathPrefix === "") return true;
  return recordPath.startsWith(pathPrefix);
}

/**
 * Tag filter — case included iff the endpoint's `tags` array contains the
 * supplied tag (exact string match). Absent filter accepts everything.
 * @param tags - The endpoint's tag list (or undefined).
 * @param tag - The optional tag from `--tag=...`.
 * @returns True iff the endpoint carries the supplied tag.
 */
function matchesTag(tags: readonly string[] | undefined, tag: string | undefined): boolean {
  if (tag === undefined || tag === "") return true;
  return Array.isArray(tags) && tags.includes(tag);
}

/**
 * Endpoint-id filter — case included iff the endpoint's id matches exactly.
 * Absent filter accepts everything.
 * @param endpointId - The case's endpoint id.
 * @param wanted - The optional single-endpoint id from `--endpoint=...`.
 * @returns True iff the endpoint id matches.
 */
function matchesEndpoint(endpointId: string, wanted: string | undefined): boolean {
  if (wanted === undefined || wanted === "") return true;
  return endpointId === wanted;
}

/**
 * Exclude-tags filter — case INCLUDED iff the endpoint carries NONE of the
 * excluded tags. Empty exclude list excludes nothing.
 * @param tags - The endpoint's tag list (or undefined).
 * @param exclude - Optional list of tags from `--exclude-tag=...`.
 * @returns True iff the endpoint carries none of the excluded tags.
 */
function passesExcludeTags(
  tags: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): boolean {
  if (!exclude || exclude.length === 0) return true;
  if (!Array.isArray(tags) || tags.length === 0) return true;
  for (const ex of exclude) {
    if (tags.includes(ex)) return false;
  }
  return true;
}
