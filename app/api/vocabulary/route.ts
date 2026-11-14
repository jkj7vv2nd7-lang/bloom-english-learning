import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maximumPageSize = 50;

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsedPage = Number.parseInt(params.get("page") ?? "1", 10);
  const parsedPageSize = Number.parseInt(params.get("pageSize") ?? "25", 10);
  const page = Number.isSafeInteger(parsedPage) ? Math.max(1, parsedPage) : 1;
  const pageSize = Number.isSafeInteger(parsedPageSize)
    ? Math.min(maximumPageSize, Math.max(1, parsedPageSize))
    : 25;
  const level = params.get("level");
  const status = params.get("status");
  const userId = params.get("userId");
  const query = params.get("q")?.trim() ?? "";

  if (query.length > 120) {
    return NextResponse.json({ error: "検索語は120文字以内で入力してください。" }, { status: 400 });
  }
  if (level && level !== "中学" && level !== "高校") {
    return NextResponse.json({ error: "レベルの指定が不正です。" }, { status: 400 });
  }
  if (status && !["learned", "unsure", "unmarked"].includes(status)) {
    return NextResponse.json({ error: "学習状態の指定が不正です。" }, { status: 400 });
  }
  if (userId && userId.length > 80) {
    return NextResponse.json({ error: "ユーザーIDの形式が不正です。" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (level) {
      conditions.push("v.level = ?");
      values.push(level);
    }
    if (query) {
      const match = query.split(/\s+/).filter(Boolean)
        .map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
      conditions.push("v.id IN (SELECT rowid FROM vocabulary_fts WHERE vocabulary_fts MATCH ?)");
      values.push(match);
    }
    if (status && status !== "unmarked") {
      conditions.push("p.status = ?");
      values.push(status);
    } else if (status === "unmarked") {
      conditions.push("p.vocabulary_id IS NULL");
    }
    const learnerJoin = userId ? "LEFT JOIN learners l ON l.id = ? LEFT JOIN user_progress p ON p.learner_id = l.id AND p.vocabulary_id = v.id" : "LEFT JOIN user_progress p ON 0";
    const filterValues = userId ? [userId, ...values] : values;
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM vocabulary v ${learnerJoin} ${where}`).get(...filterValues) as { count: number }).count;
    const pageCount = Math.ceil(total / pageSize);
    const currentPage = Math.min(page, pageCount || 1);
    const rows = db.prepare(`
      SELECT v.id, v.vocabulary_key AS vocabularyId, v.term, v.level, v.importance, v.meaning,
        v.translation, v.pronunciation, v.example, v.example_translation AS exampleTranslation, p.status
      FROM vocabulary v ${learnerJoin} ${where}
      ORDER BY CASE v.level WHEN '中学' THEN 0 ELSE 1 END, v.term, v.id
      LIMIT ? OFFSET ?
    `).all(...filterValues, pageSize, (currentPage - 1) * pageSize);
    return NextResponse.json({ items: rows, page: currentPage, pageSize, total, pageCount });
  } catch (error) {
    console.error("Failed to query vocabulary from SQLite:", error);
    return NextResponse.json({ error: "単語を検索できません。先に npm run db:seed を実行してください。" }, { status: 503 });
  }
}
