import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("MyBay Runtime JSON Schema Tests", () => {
  it("should load valid runtime schema with correct kebab-case pattern", () => {
    const schemaPath = path.resolve(process.cwd(), "public/schemas/mybay.runtime.schema.json");
    expect(fs.existsSync(schemaPath)).toBe(true);

    const schemaRaw = fs.readFileSync(schemaPath, "utf8");
    const schema = JSON.parse(schemaRaw);

    expect(schema.title).toBe("MyBayAgentRuntimeSpecification");
    expect(schema.properties.name.pattern).toBe("^[a-z0-9]+(?:-[a-z0-9]+)*$");

    // Validate pattern against valid kebab-case strings
    const kebabRegex = new RegExp(schema.properties.name.pattern);
    expect(kebabRegex.test("mybay-hermes")).toBe(true);
    expect(kebabRegex.test("pi-agent")).toBe(true);
    expect(kebabRegex.test("Invalid Name")).toBe(false);
    expect(kebabRegex.test("UPPER_CASE")).toBe(false);
    expect(kebabRegex.test("has space")).toBe(false);
  });
});
