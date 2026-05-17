/**
 * Postman collection flattener: walks the item tree depth-first in document
 * order and produces one FlattenedRequest per request item.
 *
 * Pure function (no I/O). Uses the postman-collection SDK's Item/ItemGroup
 * API to traverse the tree while accumulating folder-path context and
 * variable scopes.
 *
 * Note on variable scoping: the postman-collection SDK v5 does not expose
 * folder-level variables on hydrated ItemGroup objects. We extract folder
 * variables from the raw parsed JSON (stored in LoadedCollection.rawParsed)
 * during traversal, matching by position in the items array.
 *
 * Per-field extraction (headers, body, query, auth, script, responses) lives
 * in ./request-fields.ts to keep each file within the 300-line soft limit.
 */

import type {
  Collection,
  Item,
  ItemGroup,
  VariableList,
} from "postman-collection";

import type { FlattenedRequest, LoadedCollection } from "../types.js";

import {
  extractAuth,
  extractBody,
  extractHeaders,
  extractPreRequestScript,
  extractQuery,
  extractResponses,
} from "./request-fields.js";

/** Raw Postman request shape from the parsed JSON. */
interface RawPostmanRequest {
  /** Whether this request is disabled at the request level. */
  disabled?: boolean;
}

/** Raw Postman item shape from the parsed JSON. */
interface RawPostmanItem {
  id?: string;
  name?: string;
  disabled?: boolean;
  item?: RawPostmanItem[];
  variable?: Array<{ key: string; value: string }>;
  request?: RawPostmanRequest;
}

/**
 * Walks the Postman collection item tree and extracts a flat ordered list
 * of requests with their folder-path context and variable scopes.
 */
export class PostmanFlattener {
  /**
   * Walks the collection item tree depth-first in document order, producing
   * one FlattenedRequest per request item. Pure; no I/O.
   * @param loaded - The hydrated collection.
   * @returns Ordered FlattenedRequest list (document order).
   */
  flatten(loaded: LoadedCollection): FlattenedRequest[] {
    const results: FlattenedRequest[] = [];
    const collectionVars = this.#extractSdkVariables(loaded.sdk.variables);
    const rawItems =
      (loaded.rawParsed["item"] as RawPostmanItem[] | undefined) ?? [];
    this.#traverse(loaded.sdk, rawItems, [], collectionVars, results);
    return results;
  }

  /**
   * Recursively traverses the item tree, accumulating folder-path and variable
   * scopes, and emitting FlattenedRequest for each request item.
   * @param group - The current ItemGroup or Collection to traverse.
   * @param rawItems - Parallel raw JSON items array for variable extraction.
   * @param folderPath - Accumulated folder-path segments.
   * @param inheritedVars - Variables inherited from parent scopes.
   * @param results - Accumulator for the flattened request list.
   */
  #traverse(
    group: Collection | ItemGroup<Item>,
    rawItems: RawPostmanItem[],
    folderPath: string[],
    inheritedVars: Record<string, string>,
    results: FlattenedRequest[],
  ): void {
    const items = group.items;
    let rawIndex = 0;

    items.each((child: Item | ItemGroup<Item>) => {
      /* istanbul ignore next — provably unreachable: SDK items.each() iterates the
         same JSON items array as rawItems; both arrays originate from the same
         parsed JSON object, so rawIndex is always within bounds. */
      const rawItem: RawPostmanItem = rawItems[rawIndex] ?? {};
      rawIndex++;

      if (this.#isItemGroup(child)) {
        const folder = child as ItemGroup<Item>;
        const folderVars = this.#extractRawVariables(rawItem.variable);
        const mergedVars = { ...inheritedVars, ...folderVars };
        // A folder JSON object with an `item` array but no `name` key
        // hydrates as a nameless ItemGroup (folder.name === undefined),
        // so the `?? ""` fallback IS reachable — covered by a test.
        const newPath = [...folderPath, folder.name ?? ""];
        /* istanbul ignore next — provably unreachable: postman-collection SDK only hydrates
           an item as an ItemGroup when the raw JSON has an "item" array; therefore rawItem.item
           is always defined when this branch is reached and ?? [] is never taken. */
        const subRawItems = rawItem.item ?? [];
        this.#traverse(folder, subRawItems, newPath, mergedVars, results);
      } else {
        const item = child as Item;
        /* istanbul ignore next — provably unreachable: postman-collection
           SDK synthesizes a Request on every hydrated Item, so item.request
           is never falsy in the non-ItemGroup branch. */
        if (!item.request) return;
        results.push(
          this.#extractRequest(item, rawItem, folderPath, inheritedVars),
        );
      }
    });
  }

  /**
   * Extracts a FlattenedRequest from a Postman SDK Item.
   * @param item - The SDK Item to extract.
   * @param rawItem - The raw JSON item for disabled-flag access.
   * @param folderPath - The folder path at this item's level.
   * @param inheritedVars - Variables inherited from parent scopes.
   * @returns A FlattenedRequest.
   */
  #extractRequest(
    item: Item,
    rawItem: RawPostmanItem,
    folderPath: string[],
    inheritedVars: Record<string, string>,
  ): FlattenedRequest {
    const request = item.request;
    /* istanbul ignore next — Postman SDK always sets id/name strings on hydrated items */
    const postmanId = item.id ?? "";
    /* istanbul ignore next — Postman SDK always sets id/name strings on hydrated items */
    const name = item.name ?? "";
    /* istanbul ignore next — Postman SDK always sets method string on hydrated requests */
    const method = request?.method || "";
    /* istanbul ignore next — Postman SDK always sets url on hydrated requests */
    const rawUrl = request?.url ? request.url.toString() : "";
    const headers = extractHeaders(request);
    const body = extractBody(request);
    const query = extractQuery(request);
    const preRequestScript = extractPreRequestScript(item);
    const auth = extractAuth(request);
    const responses = extractResponses(item);
    const disabled =
      rawItem.disabled === true || rawItem.request?.disabled === true;
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
   * Extracts variables from the SDK VariableList (collection-level) into a plain record.
   * @param variables - The SDK property list of variables (may be undefined).
   * @returns A record of variable name to raw string value.
   */
  #extractSdkVariables(
    variables: VariableList | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    /* istanbul ignore next — defensive guard; SDK always provides variables list */
    if (!variables) return result;
    variables.each((v: { key?: string | undefined; value: string }) => {
      /* istanbul ignore next — defensive guard; SDK always sets key on variables */
      if (v.key) {
        result[v.key] = String(v.value);
      }
    });
    return result;
  }

  /**
   * Extracts variables from raw JSON variable array (folder-level).
   * The postman-collection SDK v5 does not expose folder variables on
   * hydrated ItemGroup objects, so we use the raw parsed JSON.
   * @param rawVars - The raw variable array from the JSON.
   * @returns A record of variable name to raw string value.
   */
  #extractRawVariables(
    rawVars: Array<{ key: string; value: string }> | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    if (!rawVars) return result;
    for (const v of rawVars) {
      if (v.key) {
        result[v.key] = String(v.value);
      }
    }
    return result;
  }

  /**
   * Type guard to distinguish ItemGroup (folder) from Item (request).
   * @param item - The SDK item to check.
   * @returns True when the item is an ItemGroup (folder).
   */
  #isItemGroup(item: Item | ItemGroup<Item>): boolean {
    return (
      item !== null &&
      typeof item === "object" &&
      "items" in item &&
      !(item as unknown as Record<string, unknown>)["request"]
    );
  }
}
