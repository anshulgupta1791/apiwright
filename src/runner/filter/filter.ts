/**
 * Run-time filters per V1_BUILD_SPEC.md §9 lines 628–635.
 *
 * Combines four filter dimensions, all AND-ed together:
 *  - `markers`: smoke / regression / e2e / all (or list).
 *  - `path`: directory subtree filter.
 *  - `tag`: endpoint tag filter (orthogonal to directory).
 *  - `endpoint`: single endpoint id.
 *  - `excludeTags`: exclude endpoints carrying any of these tags.
 *
 * Pure + deterministic + total: a single function `applyFilters` takes the
 * full set of {@link PlannedTestCase}s + the {@link EndpointLoadRecord}
 * lookup + the {@link RunFilters} and returns the filtered subset in the
 * SAME order it received them (sort is the sharder's responsibility).
 */

import type { TestMarker } from "../../core/canonical-model.js";
import { expandMarkerSelection } from "../../test-catalog/index.js";
import type {
  EndpointLoadRecord,
  PlannedTestCase,
  RunFilters,
} from "../types.js";

/**
 * Filters the planned cases by every dimension present on `filters`. AND-
 * combined: a case must pass every present dimension to be included.
 * @param cases - The full planned cases list from {@link generateTestPlan}.
 * @param endpoints - The endpoint lookup map (carries tags + path).
 * @param filters - The {@link RunFilters} snapshot.
 * @returns The subset of `cases` that pass every filter dimension; order
 *   preserved exactly as received.
 */
export function applyFilters(
  cases: readonly PlannedTestCase[],
  endpoints: ReadonlyMap<string, EndpointLoadRecord>,
  filters: RunFilters,
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
    if (!matchesPath(record.path, filters.path)) return false;
    if (!matchesTag(record.endpoint.tags, filters.tag)) return false;
    if (!matchesEndpoint(c.endpoint_id, filters.endpoint)) return false;
    if (!passesExcludeTags(record.endpoint.tags, filters.excludeTags)) return false;
    return true;
  });
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
