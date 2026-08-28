/* ============================================================================
 * THE MANAGER BRIDGE — what /Manager hands over must arrive intact.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { buildMatchSetup, availableFormations, slotSide, toTactics } from "../src/manager/bridge";
import { convertAttributes, enginePosition, overallTo20, to20 } from "../src/manager/attributes";
import { instructionsFor, styleProfile, styleMatchup, STYLE_NAMES } from "../src/manager/styles";
import { demoFixture } from "../src/data/demo-fixture";
import { loadFormations } from "../src/data";
import type { ManagerPlayer } from "../src/manager/contract";

const player = (overall: number, over: Partial<ManagerPlayer> = {}): ManagerPlayer => ({
  id: 1,
  name: "Test Player",
  pos: "CM",
  overall,
  attrs: {
    heading: 50, fitness: 50, strength: 50, leftFoot: 40, rightFoot: 70,
    speed: 50, creativity: 50, balance: 50, height: 181, weight: 76,
  },
  mentalityRating: 55,
  ...over,
});

describe("attribute conversion", () => {
  it("keeps overall as the anchor", () => {
    const weak = convertAttributes(player(45), "MC");
    const strong = convertAttributes(player(88), "MC");
    const mean = (a: object): number => {
      const values = Object.values(a) as number[];
      return values.reduce((x, y) => x + y, 0) / values.length;
    };
    expect(mean(strong)).toBeGreaterThan(mean(weak) + 4);
    expect(overallTo20(96)).toBeCloseTo(20, 0);
    expect(overallTo20(30)).toBeCloseTo(1, 0);
    expect(to20(99)).toBeCloseTo(20, 5);
  });

  it("lets the eight attributes decide the individual", () => {
    const quick = convertAttributes(player(75, { attrs: { ...player(75).attrs, speed: 95 } }), "ST");
    const slow = convertAttributes(player(75, { attrs: { ...player(75).attrs, speed: 25 } }), "ST");
    expect(quick.pace).toBeGreaterThan(slow.pace + 3);
    // ...without turning him into a different footballer everywhere else.
    expect(Math.abs(quick.passing - slow.passing)).toBeLessThanOrEqual(2);
  });

  it("reads a position, not just a rating", () => {
    const striker = convertAttributes(player(80, { pos: "FW" }), "ST");
    const centreBack = convertAttributes(player(80, { pos: "CB" }), "DC");
    expect(striker.finishing).toBeGreaterThan(centreBack.finishing);
    expect(centreBack.marking).toBeGreaterThan(striker.marking);
  });

  it("gives goalkeeping attributes only to goalkeepers", () => {
    const outfield = convertAttributes(player(80), "MC");
    expect(outfield.reflexes).toBe(1);
    expect(outfield.handling).toBe(1);
    const keeper = convertAttributes(player(80, { pos: "GK" }), "GK");
    expect(keeper.reflexes).toBeGreaterThan(10);
  });

  it("covers every attribute the engine has", () => {
    const attrs = convertAttributes(player(70), "MC");
    expect(Object.keys(attrs)).toHaveLength(32);
    for (const [key, value] of Object.entries(attrs)) {
      expect(Number.isFinite(value), key).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it("derives left and right from the formation slot", () => {
    expect(enginePosition("FB", "L")).toBe("DL");
    expect(enginePosition("FB", "R")).toBe("DR");
    expect(enginePosition("WG", "L")).toBe("ML");
    expect(enginePosition("CB", "C")).toBe("DC");
  });
});

describe("playstyles", () => {
  it("translates every Manager style into instructions", () => {
    for (const style of STYLE_NAMES) {
      const ins = instructionsFor(style);
      expect(ins.mentality).toBeGreaterThanOrEqual(1);
      expect(ins.mentality).toBeLessThanOrEqual(7);
      expect(styleProfile(style).blurb.length).toBeGreaterThan(10);
    }
  });

  it("produces the relationships the Manager's table asserts", () => {
    // High Press really does push its line up; Park the Bus really does not.
    expect(instructionsFor("High Press").defensiveLine).toBeGreaterThan(
      instructionsFor("Park the Bus").defensiveLine + 0.4,
    );
    expect(instructionsFor("Route One").passingDirectness).toBeGreaterThan(
      instructionsFor("Possession").passingDirectness + 0.5,
    );
    expect(styleMatchup("Counter", "High Press")).toContain("Counter");
    expect(styleMatchup("Route One", "Direct")).toBeNull();
  });

  it("falls back rather than throwing on an unknown style", () => {
    expect(instructionsFor("Gegenpressing 2.0").mentality).toBeGreaterThan(0);
  });
});

describe("formations", () => {
  it("ships the Manager's six shapes under the Manager's own keys", () => {
    const ids = availableFormations().map((f) => f.id);
    for (const key of ["4-4-2", "4-3-3", "4-2-3-1", "3-5-2", "5-3-2", "4-5-1"]) {
      expect(ids).toContain(key);
    }
  });

  it("has eleven slots, a keeper, and sensible anchors in each", () => {
    for (const formation of Object.values(loadFormations())) {
      expect(formation.slots).toHaveLength(11);
      expect(formation.slots[0]?.position).toBe("GK");
      for (const slot of formation.slots) {
        for (const anchor of Object.values(slot.anchors)) {
          expect(anchor.x).toBeGreaterThan(0);
          expect(anchor.x).toBeLessThan(1);
          expect(anchor.y).toBeGreaterThan(0);
          expect(anchor.y).toBeLessThan(1);
        }
      }
    }
  });

  it("puts full-backs on opposite flanks", () => {
    const formation = loadFormations()["4-4-2"]!;
    const sides = formation.slots.map((_, i) => slotSide(formation, i));
    expect(sides).toContain("L");
    expect(sides).toContain("R");
    expect(sides[0]).toBe("C"); // the keeper
  });
});

describe("buildMatchSetup", () => {
  it("turns a Manager fixture into a playable match", () => {
    const setup = buildMatchSetup(demoFixture());
    expect(setup.home.players.length).toBeGreaterThanOrEqual(11);
    expect(setup.away.players.length).toBeGreaterThanOrEqual(11);
    expect(setup.home.players[0]?.position).toBe("GK");
    expect(setup.homeTactics.formationId).toBe("4-2-3-1");
    expect(setup.awayTactics.formationId).toBe("4-4-2");
    // Player ids must be unique across the two teams or the ball cannot tell
    // who is carrying it.
    const ids = new Set([...setup.home.players, ...setup.away.players].map((p) => p.id));
    expect(ids.size).toBe(setup.home.players.length + setup.away.players.length);
  });

  it("is deterministic: the same fixture builds the same match", () => {
    const a = JSON.stringify(buildMatchSetup(demoFixture()));
    const b = JSON.stringify(buildMatchSetup(demoFixture()));
    expect(a).toBe(b);
  });

  it("falls back to 4-4-2 for a shape it does not have", () => {
    const fixture = demoFixture();
    fixture.home.formation = "5-4-1-diamond";
    expect(toTactics(fixture.home, loadFormations()).formationId).toBe("4-4-2");
  });
});
