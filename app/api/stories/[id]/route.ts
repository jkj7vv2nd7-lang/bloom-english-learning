import { NextResponse } from "next/server";
import { getStoryById } from "../../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const story = getStoryById(id);
    if (!story) return NextResponse.json({ error: "ストーリーが見つかりません。" }, { status: 404 });
    return NextResponse.json({ story });
  } catch (error) {
    console.error("Failed to load story from SQLite:", error);
    return NextResponse.json({ error: "ストーリーを読み込めません。先に npm run db:seed を実行してください。" }, { status: 503 });
  }
}
