import assert from "node:assert/strict";
import { add, double } from "./math.mjs";

assert.equal(add(1, 2), 3);
assert.equal(double(2), 4);
console.log("all tests pass");
