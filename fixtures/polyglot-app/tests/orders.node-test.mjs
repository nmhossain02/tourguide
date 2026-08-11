import assert from "node:assert/strict";
import test from "node:test";

import { orderSummary } from "../logic/orders.mjs";

test("summarizes orders", () => {
  assert.deepEqual(orderSummary([{ total: 2 }, { total: 3 }]), { count: 2, total: 5 });
});
