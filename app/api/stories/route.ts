import { NextResponse } from "next/server";
import { getStories, getStorySummaries } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const summaryOnly = new URL(request.url).searchParams.get("summary") === "true";
    const stories = summaryOnly ? getStorySummaries() : getStories();
    if (!stories.length) {
      return NextResponse.json({ error: "ストーリーが未登録です。先に npm run db:seed を実行してください。" }, { status: 503 });
    }
    return NextResponse.json({ stories });
  } catch (error) {
    console.error("Failed to load stories from SQLite:", error);
    return NextResponse.json({ error: "ストーリーを読み込めません。先に npm run db:seed を実行してください。" }, { status: 503 });
  }
}
