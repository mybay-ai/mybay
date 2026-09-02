import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MobileInstanceSheet responsive visibility", () => {
  it("keeps the management sheet visible wherever the xl:hidden trigger is available", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/dashboard/MobileInstanceSheet.tsx"),
      "utf8",
    );

    expect(source).toContain("fixed inset-0 bg-slate-900/75 z-[100] xl:hidden");
    expect(source).toContain("fixed bottom-0 left-0 right-0 bg-surface rounded-t-2xl shadow-xl z-[101] p-5 pb-8 xl:hidden");
    expect(source).not.toContain("z-[100] md:hidden");
    expect(source).not.toContain("z-[101] p-5 pb-8 md:hidden");
  });
});
