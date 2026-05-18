/**
 * PlanWarnings re-export for the test-catalog module.
 *
 * Aliases the importer Warnings class to satisfy the PlanWarnings requirement
 * without duplicating the accumulator logic (DRY). The { …, warnings } contract
 * is shared across the importer and test-catalog pipelines.
 */

import { Warnings } from "../importers/warnings.js";

/**
 * PlanWarnings is the importer Warnings accumulator, re-exported for the
 * test-catalog so the { …, warnings } contract is shared (DRY) rather than
 * duplicated. Accumulates without throwing; lists in insertion order.
 */
export { Warnings as PlanWarnings };
