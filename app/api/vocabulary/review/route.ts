import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../../lib/database";
import { scheduleNextReview } from "../../../../lib/spaced-repetition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const userId = params.get("userId");
  const level = params.get("level");
  const mode = params.get("mode");
  if (!userId || userId.length > 80) {
    return NextResponse.json({ error: "ユーザーIDが必要です。" }, { status: 400 });
  }
  if (level && level !== "中学" && level !== "高校") {
    return NextResponse.json({ error: "レベルの指定が不正です。" }, { status: 400 });
  }
  if (mode && mode !== "diagnostic") {
    return NextResponse.json({ error: "出題モードの指定が不正です。" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    const selectItems = (filterLevel?: string) => {
      const conditions: string[] = [];
      const values: Array<string | number> = [userId];
      if (filterLevel) {
        conditions.push("v.level = ?");
        values.push(filterLevel);
      }
      if (mode !== "diagnostic") {
        conditions.push("(p.next_review_at IS NULL OR julianday(p.next_review_at) <= julianday('now'))");
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const orderBy = mode === "diagnostic"
        ? "RANDOM()"
        : `CASE
            WHEN p.next_review_at IS NOT NULL AND julianday(p.next_review_at) <= julianday('now') THEN 0
            WHEN p.status = 'unsure' THEN 1
            WHEN p.status IS NULL THEN 2
            ELSE 3
          END, v.importance DESC, RANDOM()`;
      return db.prepare(`
      SELECT v.id, v.vocabulary_key AS vocabularyId, v.term, v.level, v.importance, v.meaning,
        v.translation, v.pronunciation, v.example, v.example_translation AS exampleTranslation, p.status
      FROM vocabulary v
      LEFT JOIN user_progress p ON p.learner_id = ? AND p.vocabulary_id = v.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT 24
      `).all(...values);
    };
    const items = mode === "diagnostic"
      ? [...selectItems("中学").slice(0, 12), ...selectItems("高校").slice(0, 12)]
      : selectItems(level ?? undefined);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to load daily review vocabulary from SQLite:", error);
    return NextResponse.json({ error: "今日の復習語を読み込めません。先に npm run db:seed を実行してください。" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let body: { userId?: unknown; term?: unknown; rating?: unknown; correct?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON形式のリクエストが必要です。" }, { status: 400 });
  }
  if (typeof body.userId !== "string" || body.userId.length < 1 || body.userId.length > 80) {
    return NextResponse.json({ error: "ユーザーIDの形式が不正です。" }, { status: 400 });
  }
  if (typeof body.term !== "string" || body.term.length < 1 || body.term.length > 120) {
    return NextResponse.json({ error: "単語の指定が不正です。" }, { status: 400 });
  }
  if (!["again", "hard", "good", "easy"].includes(String(body.rating)) || typeof body.correct !== "boolean") {
    return NextResponse.json({ error: "復習評価の形式が不正です。" }, { status: 400 });
  }
  const userId = body.userId;

  try {
    const db = getDatabase();
    const vocabulary = db.prepare("SELECT id FROM vocabulary WHERE term = ?").get(body.term) as { id: number } | undefined;
    if (!vocabulary) return NextResponse.json({ error: "登録されていない単語です。" }, { status: 404 });

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO learners (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(userId);
      const previous = db.prepare(`
        SELECT interval_days AS intervalDays, repetitions, ease_factor AS easeFactor
        FROM user_progress WHERE learner_id = ? AND vocabulary_id = ?
      `).get(userId, vocabulary.id) as { intervalDays: number; repetitions: number; easeFactor: number } | undefined;
      const schedule = scheduleNextReview(
        body.rating as "again" | "hard" | "good" | "easy",
        previous ?? { intervalDays: 0, repetitions: 0, easeFactor: 2.5 },
      );
      db.prepare(`
        INSERT INTO user_progress (
          learner_id, vocabulary_id, status, next_review_at, interval_days, repetitions, ease_factor,
          last_reviewed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(learner_id, vocabulary_id) DO UPDATE SET
          status = excluded.status, next_review_at = excluded.next_review_at,
          interval_days = excluded.interval_days, repetitions = excluded.repetitions,
          ease_factor = excluded.ease_factor, last_reviewed_at = excluded.last_reviewed_at,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        userId, vocabulary.id, schedule.status, schedule.nextReviewAt,
        schedule.intervalDays, schedule.repetitions, schedule.easeFactor,
      );
      db.exec("COMMIT");
      return NextResponse.json(schedule);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Failed to schedule vocabulary review:", error);
    return NextResponse.json({ error: "復習予定を保存できません。" }, { status: 503 });
  }
}
