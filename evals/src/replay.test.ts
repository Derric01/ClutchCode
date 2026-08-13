import { describe, expect, it } from "vitest";
import { checkExpectations, listFixtureFiles, replayTranscript } from "./replay.js";
import { loadTranscript } from "./transcript.js";

/**
 * The runtime regression harness (§16.3c): every recorded transcript under
 * evals/fixtures/ is replayed here, zero tokens, fully deterministic. This
 * is what "refactor-safe runtime" means in practice — change the state
 * machine, budgets, loop detector, or verification wiring, and these tests
 * catch a regression without an API key or a GPU.
 */
describe("recorded-transcript replay (§16.3c)", () => {
  for (const file of listFixtureFiles()) {
    const transcript = loadTranscript(file);

    it(`${transcript.name}: ${transcript.description}`, async () => {
      const result = await replayTranscript(transcript);
      try {
        const failures = checkExpectations(transcript, result.finalState);
        expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
      } finally {
        result.cleanup();
      }
    }, 30_000);
  }

  it("found at least the three seed fixtures (happy path + two adversarial)", () => {
    expect(listFixtureFiles().length).toBeGreaterThanOrEqual(3);
  });
});
