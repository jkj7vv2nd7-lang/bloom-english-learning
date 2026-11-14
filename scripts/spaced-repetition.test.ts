import assert from "node:assert/strict";
import test from "node:test";
import { scheduleNextReview } from "../lib/spaced-repetition";

const start = new Date("2026-01-01T00:00:00.000Z");
const fresh = { intervalDays: 0, repetitions: 0, easeFactor: 2.5 };

test("Again resets repetitions and schedules a short retry", () => {
  const result = scheduleNextReview("again", { intervalDays: 8, repetitions: 4, easeFactor: 2.5 }, start);
  assert.equal(result.status, "unsure");
  assert.equal(result.repetitions, 0);
  assert.equal(result.nextReviewAt, "2026-01-01T00:10:00.000Z");
});

test("Good grows intervals from one day to three days", () => {
  const first = scheduleNextReview("good", fresh, start);
  const second = scheduleNextReview("good", first, start);
  assert.equal(first.intervalDays, 1);
  assert.equal(second.intervalDays, 3);
  assert.equal(second.status, "learned");
});

test("Hard lowers ease without scheduling sooner than one day", () => {
  const result = scheduleNextReview("hard", fresh, start);
  assert.equal(result.status, "unsure");
  assert.equal(result.intervalDays, 1);
  assert.equal(result.easeFactor, 2.35);
});
