import type { RecallStatus } from "./models";

export type ReviewRating = "again" | "hard" | "good" | "easy";

export type ReviewSchedule = {
  status: RecallStatus;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  nextReviewAt: string;
};

export function scheduleNextReview(
  rating: ReviewRating,
  previous: { intervalDays: number; repetitions: number; easeFactor: number },
  now = new Date(),
): ReviewSchedule {
  const easeFactor = Math.max(
    1.3,
    Math.min(3.2, previous.easeFactor + (rating === "easy" ? 0.15 : rating === "hard" ? -0.15 : 0)),
  );
  let intervalDays = 0;
  let repetitions = previous.repetitions;
  let delayMilliseconds: number;
  let status: RecallStatus;

  if (rating === "again") {
    repetitions = 0;
    delayMilliseconds = 10 * 60 * 1000;
    status = "unsure";
  } else {
    repetitions += 1;
    if (rating === "hard") {
      intervalDays = Math.max(1, previous.intervalDays * 1.2);
      status = "unsure";
    } else if (rating === "easy") {
      intervalDays = previous.repetitions === 0
        ? 3
        : Math.max(4, previous.intervalDays * easeFactor * 1.3);
      status = "learned";
    } else {
      intervalDays = previous.repetitions === 0
        ? 1
        : previous.repetitions === 1
          ? 3
          : Math.max(1, previous.intervalDays * easeFactor);
      status = "learned";
    }
    delayMilliseconds = intervalDays * 24 * 60 * 60 * 1000;
  }

  return {
    status,
    intervalDays,
    repetitions,
    easeFactor,
    nextReviewAt: new Date(now.getTime() + delayMilliseconds).toISOString(),
  };
}
