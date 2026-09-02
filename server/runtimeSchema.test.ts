import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { RUNTIME_DEFINITIONS, toRuntimeManifest } from "../shared/runtimeCatalog";
import { RUNTIME_CERTIFICATION_REQUIREMENTS } from "../shared/runtimeCertification";

describe("MyBay Runtime JSON Schema Tests", () => {
  it("loads a schema that accepts extensible registered Runtime identifiers", () => {
    const schemaPath = path.resolve(process.cwd(), "public/schemas/mybay.runtime.schema.json");
    expect(fs.existsSync(schemaPath)).toBe(true);

    const schemaRaw = fs.readFileSync(schemaPath, "utf8");
    const schema = JSON.parse(schemaRaw);

    expect(schema.title).toBe("MyBayAgentRuntimeSpecification");
    expect(schema.properties.name.pattern).toBe("^[a-z0-9]+(?:-[a-z0-9]+)*$");
    expect(schema.required).toEqual(expect.arrayContaining(["release", "lifecycle"]));

    const runtimeTypeRegex = new RegExp(schema.properties.runtime.properties.type.pattern);
    expect(runtimeTypeRegex.test("hermes")).toBe(true);
    expect(runtimeTypeRegex.test("opencode")).toBe(true);
    expect(runtimeTypeRegex.test("community.runtime-v2")).toBe(true);
    expect(runtimeTypeRegex.test("Invalid Runtime")).toBe(false);
  });

  it("keeps generated public manifests identical to the shared Runtime catalog", () => {
    for (const definition of RUNTIME_DEFINITIONS) {
      const filename = definition.runtime.type === "hermes" ? "mybay.runtime.yaml" : `${definition.runtime.type}.runtime.yaml`;
      const parsed = yaml.load(fs.readFileSync(path.resolve(process.cwd(), "public/specs", filename), "utf8"));
      expect(parsed).toEqual(toRuntimeManifest(definition));
    }
  });

  it("keeps the certification evidence schema aligned with executable requirements", () => {
    const schemaPath = path.resolve(process.cwd(), "public/schemas/mybay.runtime-certification-evidence.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const requirementIds = schema.properties.checks.items.properties.requirementId.enum;
    expect(requirementIds).toEqual(RUNTIME_CERTIFICATION_REQUIREMENTS.map(({ id }) => id));
    expect(schema.properties.checks.items.properties.scope.enum).toEqual(["contract", "runtime", "e2e"]);
  });
});
