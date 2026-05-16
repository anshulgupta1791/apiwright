import { describe, it, expect } from "vitest";

/**
 * Smoke tests for the src/cli/index.ts barrel export.
 *
 * Verifies that every public symbol documented in the design §3.9 is re-exported
 * from the barrel without introducing logic of its own. This ensures consumers
 * can import from 'src/cli/index.js' without needing to know internal paths.
 */
describe("src/cli/index.ts barrel exports", () => {
  it("exports ApiwrightConfigSchemaValidator", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ApiwrightConfigSchemaValidator).toBeDefined();
    expect(typeof mod.ApiwrightConfigSchemaValidator).toBe("function");
  });

  it("exports APIWRIGHT_CONFIG_SCHEMA", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.APIWRIGHT_CONFIG_SCHEMA).toBeDefined();
  });

  it("exports formatConfigErrors", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.formatConfigErrors).toBe("function");
  });

  it("exports ConfigLoader", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ConfigLoader).toBeDefined();
    expect(typeof mod.ConfigLoader).toBe("function");
  });

  it("exports DEFAULT_CONFIG", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.DEFAULT_CONFIG).toBeDefined();
  });

  it("exports cloneDefaults", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.cloneDefaults).toBe("function");
  });

  it("exports resolveEffectiveSettings", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.resolveEffectiveSettings).toBe("function");
  });

  it("exports parseMarkers", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.parseMarkers).toBe("function");
  });

  it("exports createLogger", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.createLogger).toBe("function");
  });

  it("exports CliError", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.CliError).toBeDefined();
  });

  it("exports ConfigError", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ConfigError).toBeDefined();
  });

  it("exports ValidationFailedError", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ValidationFailedError).toBeDefined();
  });

  it("exports ProdSafetyAbortError", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ProdSafetyAbortError).toBeDefined();
  });

  it("exports NotImplementedError", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.NotImplementedError).toBeDefined();
  });

  it("exports ExitCode enum", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ExitCode).toBeDefined();
    expect(mod.ExitCode.SUCCESS).toBe(0);
    expect(mod.ExitCode.USAGE).toBe(2);
    expect(mod.ExitCode.VALIDATION).toBe(3);
    expect(mod.ExitCode.PROD_SAFETY).toBe(4);
    expect(mod.ExitCode.NOT_IMPLEMENTED).toBe(5);
    expect(mod.ExitCode.INTERNAL).toBe(70);
  });

  it("exports errorToExitCode", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.errorToExitCode).toBe("function");
  });

  it("exports handleCliError", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.handleCliError).toBe("function");
  });

  it("exports ProdSafetyGate", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ProdSafetyGate).toBeDefined();
    expect(typeof mod.ProdSafetyGate).toBe("function");
  });

  it("exports NotImplementedTestRunner", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.NotImplementedTestRunner).toBeDefined();
  });

  it("exports NotImplementedImporter", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.NotImplementedImporter).toBeDefined();
  });

  it("exports NotImplementedDocsGenerator", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.NotImplementedDocsGenerator).toBeDefined();
  });

  it("exports ValidateCommand", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.ValidateCommand).toBeDefined();
    expect(typeof mod.ValidateCommand).toBe("function");
  });

  it("exports buildProgram", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(typeof mod.buildProgram).toBe("function");
  });

  it("exports NodeFileSystem", async () => {
    const mod = await import("../../../src/cli/index.js");
    expect(mod.NodeFileSystem).toBeDefined();
  });
});
