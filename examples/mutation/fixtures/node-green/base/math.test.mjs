import assert from "node:assert/strict";
import { add } from "./math.mjs";

assert.equal(add(1, 2), 3);
console.log("base tests pass");
