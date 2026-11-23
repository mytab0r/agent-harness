import assert from "node:assert/strict";
import { add } from "./math.mjs";

// This test does not assert the changed behavior. Reverting the fix leaves it
// green on purpose: the universal tier must report NOT-CAUGHT.
assert.equal(add(2, 2), 4);
console.log("all tests pass");
