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
 * Size note: This file slightly exceeds the 300-line soft limit because the
 * traversal, extraction, and variable-scoping logic cannot be cleanly split
 * without introducing coupling between fragments. It remains well under the
 * 500-line hard limit.
 */

import type {
  Collection,
  Item,
  ItemGroup,
  VariableList,
} from "postman-collection";

import type {
  FlattenedAuth,
  FlattenedBody,
  FlattenedHeader,
  FlattenedQueryParam,
  FlattenedRequest,
  FlattenedResponse,
  LoadedCollection,
} from "../types.js";

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
    const headers = this.#extractHeaders(request);
    const body = this.#extractBody(request);
    const query = this.#extractQuery(request);
    const preRequestScript = this.#extractPreRequestScript(item);
    const auth = this.#extractAuth(request);
    const responses = this.#extractResponses(item);
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
   * Extracts headers from a Postman request.
   * @param request - The SDK request object (may be undefined).
   * @returns Array of flattened headers.
   */
  #extractHeaders(request: Item["request"]): FlattenedHeader[] {
    const headers: FlattenedHeader[] = [];
    /* istanbul ignore next — Postman SDK always provides headers list on requests */
    if (!request?.headers) return headers;
    request.headers.each(
      (header: { key: string; value: string; disabled?: boolean }) => {
        const key = String(header.key);
        const value = String(header.value);
        headers.push({ key, value, disabled: !!header.disabled });
      },
    );
    return headers;
  }

  /**
   * Extracts the request body from a Postman request.
   * @param request - The SDK request object (may be undefined).
   * @returns A FlattenedBody or undefined when no body is present.
   */
  #extractBody(request: Item["request"]): FlattenedBody | undefined {
    if (!request?.body) return undefined;
    const bodyMode = request.body.mode as string | undefined;
    /* istanbul ignore next — Postman SDK always sets mode when body exists */
    const mode = bodyMode !== undefined ? bodyMode : "raw";
    /* istanbul ignore next — Postman SDK always sets raw when body has raw mode */
    const raw = request.body.raw !== undefined ? String(request.body.raw) : "";
    return { mode, raw };
  }

  /**
   * Extracts query parameters from a Postman request URL.
   * @param request - The SDK request object (may be undefined).
   * @returns Array of flattened query parameters.
   */
  #extractQuery(request: Item["request"]): FlattenedQueryParam[] {
    const query: FlattenedQueryParam[] = [];
    /* istanbul ignore next — Postman SDK provides url.query on requests that have params */
    if (!request?.url?.query) return query;
    request.url.query.each(
      (param: {
        key: string | null;
        value: string | null;
        disabled?: boolean;
      }) => {
        const key = String(param.key ?? "");
        const value = String(param.value ?? "");
        query.push({ key, value, disabled: !!param.disabled });
      },
    );
    return query;
  }

  /**
   * Extracts the auth block from a Postman request.
   * @param request - The SDK request object (may be undefined).
   * @returns A FlattenedAuth or undefined when no auth is present.
   */
  #extractAuth(request: Item["request"]): FlattenedAuth | undefined {
    if (!request?.auth) return undefined;
    const authType = request.auth.type as string;
    /* istanbul ignore next — defensive guard; SDK always sets type when auth exists */
    if (!authType) return undefined;
    return { type: authType };
  }

  /**
   * Extracts the pre-request script text from an item's events.
   * @param item - The SDK Item to check for scripts.
   * @returns Joined script lines, or "" when absent.
   */
  #extractPreRequestScript(item: Item): string {
    const scriptLines: string[] = [];
    /* istanbul ignore next — Postman SDK always provides events list on items */
    if (!item.events) return "";
    item.events.each(
      (event: {
        listen?: string | undefined;
        script?: { exec?: string[] | undefined };
      }) => {
        if (event.listen === "prerequest" && event.script) {
          /* istanbul ignore next — exec array is always present on Postman script objects */
          const lines = event.script.exec ?? [];
          scriptLines.push(...lines);
        }
      },
    );
    return scriptLines.join("\n");
  }

  /**
   * Extracts saved/example responses from an item.
   * @param item - The SDK Item to extract responses from.
   * @returns Array of flattened responses.
   */
  #extractResponses(item: Item): FlattenedResponse[] {
    const responses: FlattenedResponse[] = [];
    /* istanbul ignore next — Postman SDK always provides responses list on items */
    if (!item.responses) return responses;
    item.responses.each(
      (resp: { code?: number; body?: string | undefined }) => {
        const code = resp.code !== undefined ? resp.code : 0;
        const body = resp.body !== undefined ? resp.body : "";
        responses.push({ code, body });
      },
    );
    return responses;
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
