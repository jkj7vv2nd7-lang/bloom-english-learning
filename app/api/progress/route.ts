import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../lib/database";
import type { RecallStatus } from "../../../lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validUserId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 80;
}

export function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  if (!validUserId(userId)) return NextResponse.json({ error: "ユーザーIDが必要です。" }, { status: 400 });
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT v.term, p.status FROM user_progress p
      JOIN vocabulary v ON v.id = p.vocabulary_id
      WHERE p.learner_id = ?
    `).all(userId) as Array<{ term: string; status: RecallStatus }>;
    const counts = db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'learned') AS learned,
        COUNT(*) FILTER (WHERE status = 'unsure') AS unsure
      FROM user_progress WHERE learner_id = ?
    `).get(userId) as { learned: number; unsure: number };
    const vocabularyCount = (db.prepare("SELECT COUNT(*) AS count FROM vocabulary").get() as { count: number }).count;
    const byLevel = db.prepare(`
      SELECT v.level, COUNT(*) AS total,
        SUM(CASE WHEN p.status = 'learned' THEN 1 ELSE 0 END) AS learned,
        SUM(CASE WHEN p.next_review_at IS NOT NULL AND julianday(p.next_review_at) <= julianday('now') THEN 1 ELSE 0 END) AS due
      FROM vocabulary v
      LEFT JOIN user_progress p ON p.learner_id = ? AND p.vocabulary_id = v.id
      GROUP BY v.level
      ORDER BY CASE v.level WHEN '中学' THEN 0 ELSE 1 END
    `).all(userId) as Array<{ level: string; total: number; learned: number; due: number }>;
    const dueCount = (db.prepare(`
      SELECT COUNT(*) AS count FROM user_progress
      WHERE learner_id = ? AND next_review_at IS NOT NULL
        AND julianday(next_review_at) <= julianday('now')
    `).get(userId) as { count: number }).count;
    return NextResponse.json({
      statuses: Object.fromEntries(rows.map(({ term, status }) => [term, status])),
      learnedCount: counts.learned,
      unsureCount: counts.unsure,
      vocabularyCount,
      byLevel,
      dueCount,
    });
  } catch (error) {
    console.error("Failed to load learning progress from SQLite:", error);
    return NextResponse.json({ error: "学習状態を読み込めません。" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  let body: { userId?: unknown; statuses?: unknown; legacyMigration?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON形式のリクエストが必要です。" }, { status: 400 });
  }
  if (!validUserId(body.userId) || typeof body.statuses !== "object" || body.statuses === null || Array.isArray(body.statuses)) {
    return NextResponse.json({ error: "ユーザーIDまたは学習状態の形式が不正です。" }, { status: 400 });
  }
  const entries = Object.entries(body.statuses);
  if (entries.length > 1000 || entries.some(([, status]) => status !== "learned" && status !== "unsure")) {
    return NextResponse.json({ error: "学習状態の値が不正です。" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO learners (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(body.userId);
      const upsert = db.prepare(`
        INSERT INTO user_progress (learner_id, vocabulary_id, status)
        SELECT ?, id, ? FROM vocabulary WHERE term = ?
        ON CONFLICT(learner_id, vocabulary_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
      `);
      for (const [term, status] of entries) {
        const result = upsert.run(body.userId, status, term);
        if (result.changes === 0 && body.legacyMigration !== true) throw new Error(`Unknown vocabulary term: ${term}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof Error && error.message.startsWith("Unknown vocabulary term:")) {
        return NextResponse.json({ error: "登録されていない単語が含まれています。" }, { status: 400 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to save learning progress to SQLite:", error);
    return NextResponse.json({ error: "学習状態を保存できません。" }, { status: 503 });
  }
}
