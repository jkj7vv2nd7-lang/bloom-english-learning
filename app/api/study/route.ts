import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type StudyGoal = "junior-entrance" | "university-entrance" | "all";
const defaultDailyGoal = 5;
const defaultStudyGoal: StudyGoal = "junior-entrance";

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getStudyStats(userId: string, date: string) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT study_date AS studyDate, reviewed_count AS reviewedCount
    FROM user_study_days
    WHERE learner_id = ? AND study_date <= ?
    ORDER BY study_date DESC
    LIMIT 400
  `).all(userId, date) as Array<{ studyDate: string; reviewedCount: number }>;
  const countsByDate = new Map(rows.map((row) => [row.studyDate, row.reviewedCount]));
  let cursor = countsByDate.has(date) ? date : previousDate(date);
  let streakDays = 0;
  while (countsByDate.has(cursor)) {
    streakDays += 1;
    cursor = previousDate(cursor);
  }
  const settings = db.prepare(`
    SELECT daily_goal AS dailyGoal, study_goal AS studyGoal
    FROM learners WHERE id = ?
  `).get(userId) as { dailyGoal: number; studyGoal: StudyGoal } | undefined;
  const weekStart = dateOffset(date, -6);
  const weekRows = db.prepare(`
    SELECT study_date AS studyDate, reviewed_count AS reviewedCount
    FROM user_study_days WHERE learner_id = ? AND study_date BETWEEN ? AND ?
  `).all(userId, weekStart, date) as Array<{ studyDate: string; reviewedCount: number }>;
  const weekCounts = new Map(weekRows.map((row) => [row.studyDate, row.reviewedCount]));
  const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
    const studyDate = dateOffset(weekStart, index);
    return { date: studyDate, count: weekCounts.get(studyDate) ?? 0 };
  });
  return {
    todayCount: countsByDate.get(date) ?? 0,
    dailyGoal: settings?.dailyGoal ?? defaultDailyGoal,
    studyGoal: settings?.studyGoal ?? defaultStudyGoal,
    streakDays,
    weeklyActivity,
  };
}

function validUserId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 80;
}

function validStudyGoal(value: unknown): value is StudyGoal {
  return value === "junior-entrance" || value === "university-entrance" || value === "all";
}

function getJapanDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  const date = request.nextUrl.searchParams.get("date");
  if (!validUserId(userId) || !validDate(date)) {
    return NextResponse.json({ error: "ユーザーIDまたは日付の形式が不正です。" }, { status: 400 });
  }
  try {
    return NextResponse.json(getStudyStats(userId, date));
  } catch (error) {
    console.error("Failed to load daily study activity from SQLite:", error);
    return NextResponse.json({ error: "今日の学習状況を読み込めません。" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let body: { userId?: unknown; date?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON形式のリクエストが必要です。" }, { status: 400 });
  }

  if (!validUserId(body.userId) || !validDate(body.date)) {
    return NextResponse.json({ error: "ユーザーIDまたは日付の形式が不正です。" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO learners (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(body.userId);
      db.prepare(`
        INSERT INTO user_study_days (learner_id, study_date, reviewed_count)
        VALUES (?, ?, 1)
        ON CONFLICT(learner_id, study_date)
        DO UPDATE SET reviewed_count = user_study_days.reviewed_count + 1
      `).run(body.userId, body.date);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return NextResponse.json(getStudyStats(body.userId, body.date));
  } catch (error) {
    console.error("Failed to record daily study activity in SQLite:", error);
    return NextResponse.json({ error: "今日の学習状況を保存できません。" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  let body: { userId?: unknown; dailyGoal?: unknown; studyGoal?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON形式のリクエストが必要です。" }, { status: 400 });
  }
  if (!validUserId(body.userId)) {
    return NextResponse.json({ error: "ユーザーIDの形式が不正です。" }, { status: 400 });
  }
  if (body.dailyGoal !== undefined && (
    typeof body.dailyGoal !== "number" || !Number.isInteger(body.dailyGoal) || body.dailyGoal < 1 || body.dailyGoal > 30
  )) {
    return NextResponse.json({ error: "1〜30問の範囲で目標を設定してください。" }, { status: 400 });
  }
  if (body.studyGoal !== undefined && !validStudyGoal(body.studyGoal)) {
    return NextResponse.json({ error: "学習コースの指定が不正です。" }, { status: 400 });
  }
  if (body.dailyGoal === undefined && body.studyGoal === undefined) {
    return NextResponse.json({ error: "更新する学習設定がありません。" }, { status: 400 });
  }
  const userId = body.userId;
  try {
    const db = getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO learners (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(userId);
      const current = db.prepare(`
        SELECT daily_goal AS dailyGoal, study_goal AS studyGoal
        FROM learners WHERE id = ?
      `).get(userId) as { dailyGoal: number; studyGoal: StudyGoal };
      db.prepare("UPDATE learners SET daily_goal = ?, study_goal = ? WHERE id = ?").run(
        body.dailyGoal === undefined ? current.dailyGoal : body.dailyGoal,
        body.studyGoal === undefined ? current.studyGoal : body.studyGoal,
        userId,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return NextResponse.json(getStudyStats(userId, getJapanDate()));
  } catch (error) {
    console.error("Failed to update learner study settings:", error);
    return NextResponse.json({ error: "学習設定を保存できません。" }, { status: 503 });
  }
}
