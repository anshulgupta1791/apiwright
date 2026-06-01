/**
 * Postman collection flattener: walks the item tree depth-first in document
 * order and produces one FlattenedRequest per request item.
 *
 * Pure function (no I/O). Walks the raw parsed Postman v2.1 JSON via the
 * in-house `PostmanV21Item` / `PostmanV21Collection` types defined in
 * `./v2-schema.ts`. (Earlier versions used the `postman-collection` SDK's
 * `.each()` iteration; the SDK was dropped to eliminate its vulnerable
 * lodash + uuid transitive deps — see Lens 0 audit blocker B13.)
 *
 * Per-field extraction (headers, body, query, auth, script, responses) lives
 * in ./request-fields.ts to keep each file within the 300-line soft limit.
 */

import type { FlattenedRequest, LoadedCollection } from "../types.js";

import {
  extractAuth,
  extractBody,
  extractHeaders,
  extractPreRequestScript,
  extractQuery,
  extractResponses,
} from "./request-fields.js";
import type {
  PostmanV21Collection,
  PostmanV21Item,
  PostmanV21Variable,
} from "./v2-schema.js";
import { isFolder, urlToString } from "./v2-schema.js";

/**
 * Walks the Postman collection item tree and extracts a flat ordered list
 * of requests with their folder-path context and variable scopes.
 */
export class PostmanFlattener {
  /**
   * Walks the collection item tree depth-first in document order, producing
   * one FlattenedRequest per request item. Pure; no I/O.
   * @param loaded - The validated collection.
   * @returns Ordered FlattenedRequest list (document order).
   */
  flatten(loaded: LoadedCollection): FlattenedRequest[] {
    const results: FlattenedRequest[] = [];
    const collection: PostmanV21Collection = loaded.parsed;
    const collectionVars = this.#extractVariables(collection.variable);
    this.#traverse(collection.item, [], collectionVars, results);
    return results;
  }

  /**
   * Recursively traverses the item tree, accumulating folder-path and variable
   * scopes, and emitting FlattenedRequest for each request item.
   * @param items - The current items array to traverse.
   * @param folderPath - Accumulated folder-path segments.
   * @param inheritedVars - Variables inherited from parent scopes.
   * @param results - Accumulator for the flattened request list.
   */
  #traverse(
    items: ReadonlyArray<PostmanV21Item>,
    folderPath: string[],
    inheritedVars: Record<string, string>,
    results: FlattenedRequest[],
  ): void {
    for (const item of items) {
      if (isFolder(item)) {
        // Folder JSON object: walk children with extended folder path +
        // merged variables. A folder JSON without `name` becomes a nameless
        // segment — preserved for round-trippability.
        const folderVars = this.#extractVariables(item.variable);
        const mergedVars = { ...inheritedVars, ...folderVars };
        const newPath = [...folderPath, item.name ?? ""];
        /* istanbul ignore next — `isFolder(item)` returned true so
           `item.item` is provably an array; the `?? []` fallback is
           a defensive guard against a TS narrowing limit, not reachable. */
        const children = item.item ?? [];
        this.#traverse(children, newPath, mergedVars, results);
      } else {
        // Request item: skip if it has no request body at all (degenerate).
        if (!item.request) continue;
        results.push(this.#extractRequest(item, folderPath, inheritedVars));
      }
    }
  }

  /**
   * Extracts a FlattenedRequest from a raw Postman v2.1 item.
   * @param item - The raw item.
   * @param folderPath - The folder path at this item's level.
   * @param inheritedVars - Variables inherited from parent scopes.
   * @returns A FlattenedRequest.
   */
  #extractRequest(
    item: PostmanV21Item,
    folderPath: string[],
    inheritedVars: Record<string, string>,
  ): FlattenedRequest {
    const request = item.request;
    const postmanId = item.id ?? "";
    const name = item.name ?? "";
    /* istanbul ignore next — `isFolder` returned false so item.request is
       defined here; the optional access just keeps TS narrowing happy. */
    const method = request?.method ?? "";
    const rawUrl = urlToString(request?.url);
    const headers = extractHeaders(request);
    const body = extractBody(request);
    const query = extractQuery(request);
    const preRequestScript = extractPreRequestScript(item);
    const auth = extractAuth(request);
    const responses = extractResponses(item);
    const disabled = item.disabled === true || request?.disabled === true;
    const variables = { ...inheritedVars };

    return {
      postmanId,
      name,
      folderPath,
      method,
      rawUrl,
      headers,
      ...(body !== undefined ? { body } : {}),
      query,
      preRequestScript,
      ...(auth !== undefined ? { auth } : {}),
      responses,
      disabled,
      variables,
    };
  }

  /**
   * Extracts variables from a raw `variable` array into a plain record,
   * coercing values to strings (Postman vars are sometimes typed `boolean`
   * or `number` in the JSON but we surface them as strings to match
   * existing FlattenedRequest contract).
   * @param vars - The raw variable array (collection- or folder-level).
   * @returns A record of variable name to raw string value.
   */
  #extractVariables(
    vars: ReadonlyArray<PostmanV21Variable> | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    if (!vars) return result;
    for (const v of vars) {
      if (typeof v.key === "string" && v.key.length > 0) {
        result[v.key] = this.#coerceVariableValue(v.value);
      }
    }
    return result;
  }

  /**
   * Coerces a Postman variable's `value` to a string. Postman JSON allows
   * scalar values (string / number / boolean), `null`, or `undefined`. We
   * surface all as strings; objects/arrays (rare and not part of the
   * documented schema) are JSON-stringified rather than yielding the
   * default `[object Object]`.
   * @param value - The raw value from the parsed JSON.
   * @returns A string representation.
   */
  #coerceVariableValue(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    // Defensive only — Postman variable values are documented as scalars.
    return JSON.stringify(value);
  }
}
