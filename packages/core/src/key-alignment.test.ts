import { describe, expect, it } from "vitest";
import { alignKeys } from "./key-alignment";
import { parseKey } from "./key-parser";

describe("parseKey", () => {
  it("splits LevelName_baseName_UID into parts", () => {
    const p = parseKey("Site_Area_12", ["Site", "Region"]);
    expect(p).toEqual({ raw: "Site_Area_12", levelName: "Site", baseName: "Area", uniqueId: "12" });
  });
  it("handles level names with underscores via known-name matching", () => {
    const p = parseKey("Main_Site_Area_Measure_99", ["Main_Site"]);
    expect(p.levelName).toBe("Main_Site");
    expect(p.baseName).toBe("Area_Measure");
    expect(p.uniqueId).toBe("99");
  });
  it("handles keys without trailing UID", () => {
    const p = parseKey("Site_Area", ["Site"]);
    expect(p).toEqual({ raw: "Site_Area", levelName: "Site", baseName: "Area", uniqueId: null });
  });
});

describe("alignKeys", () => {
  it("matches identical keys first", () => {
    const r = alignKeys({
      source: [{ key: "Site_Area_12" }],
      target: [{ key: "Site_Area_12" }],
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Site"],
      levelMap: {},
    });
    expect(r.decisions[0]!.method).toBe("exact-key");
    expect(r.decisions[0]!.targetKey).toBe("Site_Area_12");
    expect(r.aiQueue).toHaveLength(0);
  });

  it("level rename preserves baseName + UID", () => {
    const r = alignKeys({
      source: [{ key: "Site_Area_12" }, { key: "Site_Count_9" }],
      target: [{ key: "Facility_Area_12" }, { key: "Facility_Count_9" }],
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Facility"],
      levelMap: { Site: "Facility" },
    });
    expect(r.decisions).toHaveLength(2);
    expect(r.decisions.every((d) => d.method === "level-swap-exact")).toBe(true);
    expect(r.aiQueue).toHaveLength(0);
  });

  it("UID drift within renamed level is matched as level-swap-fuzzy", () => {
    const r = alignKeys({
      source: [{ key: "Site_Area_12" }],
      target: [{ key: "Facility_Area_78" }], // different UID
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Facility"],
      levelMap: { Site: "Facility" },
    });
    expect(r.decisions[0]!.method).toBe("level-swap-fuzzy");
    expect(r.decisions[0]!.targetKey).toBe("Facility_Area_78");
    expect(r.decisions[0]!.confidence).toBeGreaterThan(0.9);
  });

  it("ambiguous baseName within level goes to AI queue with candidates", () => {
    const r = alignKeys({
      source: [{ key: "Site_Count_12" }],
      target: [{ key: "Facility_Count_1" }, { key: "Facility_Count_2" }],
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Facility"],
      levelMap: { Site: "Facility" },
    });
    expect(r.aiQueue).toHaveLength(1);
    expect(r.aiQueue[0]!.candidates).toHaveLength(2);
  });

  it("formula co-occurrence boosts confidence for an otherwise-fuzzy match", () => {
    const r = alignKeys({
      source: [
        { key: "Site_Revenue_1" },
        { key: "Site_Cost_2" },
      ],
      target: [
        { key: "Facility_Revenue_91" },
        { key: "Facility_Cost_92" },
      ],
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Facility"],
      // Missing level map on purpose to force the global path.
      levelMap: {},
      sourceFormulas: ["{{Site_Revenue_1}} - {{Site_Cost_2}}"],
      targetFormulas: ["{{Facility_Revenue_91}} - {{Facility_Cost_92}}"],
    });
    const rev = r.decisions.find((d) => d.sourceKey === "Site_Revenue_1");
    expect(rev?.targetKey).toBe("Facility_Revenue_91");
    expect(rev?.method === "cooccurrence-boost" || rev?.method === "global-fuzzy").toBe(true);
  });

  it("leaves truly unknown keys in the AI queue with zero confidence", () => {
    const r = alignKeys({
      source: [{ key: "Site_Mystery_7" }],
      target: [{ key: "Facility_Totally_Different_99" }],
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Facility"],
      levelMap: { Site: "Facility" },
    });
    expect(r.aiQueue).toHaveLength(1);
    expect(r.aiQueue[0]!.confidence).toBe(0);
  });

  it("reports unused target keys so the UI can surface orphans", () => {
    const r = alignKeys({
      source: [{ key: "Site_Area_12" }],
      target: [{ key: "Facility_Area_12" }, { key: "Facility_Orphan_1" }],
      sourceLevelNames: ["Site"],
      targetLevelNames: ["Facility"],
      levelMap: { Site: "Facility" },
    });
    expect(r.unusedTargetKeys).toContain("Facility_Orphan_1");
  });
});
