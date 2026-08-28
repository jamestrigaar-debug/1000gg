import { describe, expect, it } from "vitest";
import { GOAL_WIDTH, PITCH_LENGTH, PITCH_WIDTH } from "../src/core/constants";
import {
  crossedLine,
  goalAngle,
  inBox,
  inPlayArea,
  penaltyArea,
  penaltySpot,
  sixYardBox,
} from "../src/core/pitch";

describe("pitch geometry", () => {
  it("matches the laws of the game", () => {
    const right = penaltyArea(1);
    expect(right.maxX - right.minX).toBeCloseTo(16.5, 6);
    expect(right.maxY - right.minY).toBeCloseTo(40.32, 6);
    const six = sixYardBox(-1);
    expect(six.maxX - six.minX).toBeCloseTo(5.5, 6);
    expect(six.maxY - six.minY).toBeCloseTo(18.32, 6);
    expect(penaltySpot(1).x).toBeCloseTo(PITCH_LENGTH - 11, 6);
    expect(penaltySpot(-1).x).toBeCloseTo(11, 6);
  });

  it("knows what is inside the penalty area", () => {
    expect(inBox({ x: 100, y: 34 }, penaltyArea(1))).toBe(true);
    expect(inBox({ x: 80, y: 34 }, penaltyArea(1))).toBe(false);
    expect(inPlayArea({ x: -0.5, y: 34 })).toBe(false);
    expect(inPlayArea({ x: 0, y: 0 })).toBe(true);
  });

  it("gives the goal angle its expected shape", () => {
    const closeCentral = goalAngle({ x: PITCH_LENGTH - 6, y: 34 }, 1);
    const farCentral = goalAngle({ x: PITCH_LENGTH - 30, y: 34 }, 1);
    const tight = goalAngle({ x: PITCH_LENGTH - 6, y: 2 }, 1);
    expect(closeCentral).toBeGreaterThan(farCentral);
    expect(closeCentral).toBeGreaterThan(tight);
    // A yard out, dead centre, you can see most of the goal.
    expect(goalAngle({ x: PITCH_LENGTH - 1, y: 34 }, 1)).toBeGreaterThan(1.8);
  });

  it("detects the first line the ball crosses, in travel order", () => {
    const goal = crossedLine({ x: 100, y: 34 }, { x: 106, y: 34 });
    expect(goal?.line).toBe("goal");
    expect(goal?.line === "goal" && goal.side).toBe(1);
    expect(Math.abs((goal?.at.y ?? 0) - 34)).toBeLessThan(GOAL_WIDTH);

    const touch = crossedLine({ x: 50, y: 2 }, { x: 50, y: -3 });
    expect(touch?.line).toBe("touch");
    expect(touch?.line === "touch" && touch.side).toBe("top");

    // A ball heading for the corner crosses whichever line comes first.
    const corner = crossedLine({ x: 104, y: 66 }, { x: 110, y: 74 });
    expect(corner).not.toBeNull();
    expect(corner!.t).toBeLessThan(0.5);

    expect(crossedLine({ x: 50, y: 34 }, { x: 55, y: 30 })).toBeNull();
    expect(PITCH_WIDTH).toBe(68);
  });
});
