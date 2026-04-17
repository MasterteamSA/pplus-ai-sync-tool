import { describe, expect, it } from "vitest";
import { rewriteFormula, validateRewrittenKeys } from "./rewriter";
import { extractKeys } from "./parser";

describe("rewriteFormula", () => {
  it("substitutes keys listed in the map", () => {
    const r = rewriteFormula("SUM({{Site_Area}}) / {{Site_Count}}", {
      Site_Area: "Facility_Area",
      Site_Count: "Facility_Count",
    });
    expect(r.after).toBe("SUM({{Facility_Area}}) / {{Facility_Count}}");
    expect(r.changed).toBe(true);
    expect(r.rewrites).toHaveLength(2);
  });

  it("leaves unmapped keys alone", () => {
    const r = rewriteFormula("{{Site_Area}} + {{Unchanged_Key}}", { Site_Area: "Facility_Area" });
    expect(r.after).toBe("{{Facility_Area}} + {{Unchanged_Key}}");
    expect(r.rewrites).toHaveLength(1);
  });

  it("is a no-op when no keys match", () => {
    const r = rewriteFormula("plain text {{Foo}}", { Bar: "Baz" });
    expect(r.changed).toBe(false);
    expect(r.after).toBe("plain text {{Foo}}");
  });
});

describe("validateRewrittenKeys", () => {
  it("flags keys missing from the allow-set", () => {
    const unknown = validateRewrittenKeys("{{A}} {{B}}", new Set(["A"]));
    expect(unknown).toEqual(["B"]);
  });
});

describe("extractKeys", () => {
  it("returns all keys in order", () => {
    expect(extractKeys("{{a}} + {{b}} - {{a}}")).toEqual(["a", "b", "a"]);
  });
});
