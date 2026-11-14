"use client";

import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import RecallControls from "../components/RecallControls";
import { useRecallStatuses } from "../recall";
import type { Vocabulary } from "../../lib/models";
import { SpeechSettings, useSpeech } from "../speech";

type LevelFilter = "すべて" | "中学" | "高校";
type StatusFilter = "すべて" | "覚えた" | "まだ不安" | "未設定";
type VocabularyResponse = {
  items: Vocabulary[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

const pageSize = 25;

export default function WordbookPage() {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("すべて");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("すべて");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [response, setResponse] = useState<VocabularyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const speech = useSpeech();
  const { statuses, setStatus, storageMessage, userId, progress } = useRecallStatuses();

  useEffect(() => {
    setPage(1);
  }, [levelFilter, statusFilter, query]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), userId });
    if (levelFilter !== "すべて") params.set("level", levelFilter);
    if (statusFilter !== "すべて") {
      params.set("status", statusFilter === "覚えた" ? "learned" : statusFilter === "まだ不安" ? "unsure" : "unmarked");
    }
    if (query.trim()) params.set("q", query.trim());

    setLoading(true);
    fetch(`/api/vocabulary?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) {
          const data = await result.json() as { error?: string };
          throw new Error(data.error ?? "単語を読み込めませんでした。");
        }
        return result.json() as Promise<VocabularyResponse>;
      })
      .then((data) => {
        setResponse(data);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "単語を読み込めませんでした。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [levelFilter, page, query, refreshKey, statusFilter, userId, statuses]);

  async function changeStatus(term: string, status: "learned" | "unsure") {
    await setStatus(term, status);
    setRefreshKey((value) => value + 1);
  }

  const items = response?.items ?? [];
  const learnedCount = progress.learnedCount;
  const unsureCount = progress.unsureCount;
  const totalWords = progress.vocabularyCount;

  return (
    <main className="app-shell">
      <AppHeader active="wordbook" />
      <div className="page-content wordbook-page">
        <section className="wordbook-heading">
          <p className="eyebrow"><span>MY VOCABULARY</span> · REVIEW</p>
          <h1>ことばのコレクション</h1>
          <p>出会った単語を、発音・意味・例文と一緒に振り返り。学習状態はストーリー画面と同期されます。</p>
        </section>

        <section className="wordbook-summary card" aria-label="学習状況">
          <div className="summary-item"><span className="summary-icon learned-summary" aria-hidden="true">✓</span><div><span>覚えた</span><strong>{learnedCount}<small> / {totalWords}語</small></strong></div></div>
          <div className="summary-item"><span className="summary-icon unsure-summary" aria-hidden="true">!</span><div><span>まだ不安</span><strong>{unsureCount}<small>語</small></strong></div></div>
          <div className="summary-progress"><div className="progress-label"><span>学習の進み具合</span><strong>{totalWords ? Math.round((learnedCount / totalWords) * 100) : 0}%</strong></div><div className="progress-track"><span style={{ width: `${totalWords ? (learnedCount / totalWords) * 100 : 0}%` }} /></div></div>
        </section>

        <section className="wordbook-tools card" aria-label="単語を絞り込む">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="英単語・意味を検索" aria-label="英単語や意味を検索" />
          </label>
          <label className="filter-field"><span>レベル</span><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}><option>すべて</option><option>中学</option><option>高校</option></select></label>
          <label className="filter-field"><span>学習状態</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option>すべて</option><option>覚えた</option><option>まだ不安</option><option>未設定</option></select></label>
        </section>
        <div className="wordbook-audio-settings card">
          <span className="detail-label">発音を聴く</span>
          <SpeechSettings controller={speech} />
        </div>

        <div className="wordbook-list-heading">
          <h2>登録語彙 <span>{response ? `${response.total}語` : "…"}</span></h2>
          <p>1ページ{pageSize}語まで表示</p>
        </div>
        {storageMessage && <p className="storage-message wordbook-storage-message" role="status">{storageMessage}</p>}
        <p className="speech-status wordbook-speech-status" aria-live="polite">{speech.message}</p>
        {loadError ? (
          <div className="empty-wordbook card" role="alert"><p>{loadError}</p><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>再読み込み</button></div>
        ) : loading && !response ? (
          <div className="empty-wordbook card" role="status"><p>単語を読み込んでいます…</p></div>
        ) : items.length ? (
          <>
            <section className="wordbook-grid" aria-label="単語一覧" aria-busy={loading}>
              {items.map((item) => {
                const status = statuses[item.term] ?? item.status;
                return (
                  <article className={`vocabulary-card card${status === "unsure" ? " vocabulary-unsure" : status === "learned" ? " vocabulary-learned" : ""}`} key={item.term}>
                    <div className="vocabulary-card-top">
                      <span className="word-level">{item.level}レベル</span>
                      <span className="wordbook-stars" aria-label={`重要度 ${item.importance} / 3`}>{"★".repeat(item.importance)}<span>{"★".repeat(3 - item.importance)}</span></span>
                    </div>
                    <div className="wordbook-term-row">
                      <h3>{item.term}</h3>
                      <button className="word-speech-button" type="button" onClick={() => speech.speak(item.term)} aria-label={`${item.term}を読み上げる`}><span aria-hidden="true">🔊</span></button>
                    </div>
                    <p className="wordbook-pronunciation">{item.pronunciation}</p>
                    <p className="wordbook-meaning">{item.meaning}</p>
                    <p className="wordbook-example">{item.example}<br /><span>{item.exampleTranslation}</span></p>
                    <div className="wordbook-card-footer">
                      <RecallControls status={status} onChange={(nextStatus) => void changeStatus(item.term, nextStatus)} />
                    </div>
                  </article>
                );
              })}
            </section>
            <nav className="pagination" aria-label="単語帳ページ">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>← 前へ</button>
              <span>{page} / {response?.pageCount || 1} ページ</span>
              <button type="button" disabled={page >= (response?.pageCount ?? 1) || loading} onClick={() => setPage((value) => value + 1)}>次へ →</button>
            </nav>
          </>
        ) : (
          <div className="empty-wordbook card"><span aria-hidden="true">⌕</span><p>{loading ? "単語を読み込んでいます…" : "条件に合う単語がありません。"}</p><button type="button" onClick={() => { setQuery(""); setLevelFilter("すべて"); setStatusFilter("すべて"); }}>絞り込みをクリア</button></div>
        )}
        <footer className="page-footer">
          <span>Bloom English</span>
          <span>語彙はCEFR-J Wordlist A1/A2を参考に編集選定したものです。現行教科書の全語彙を網羅する公式リストではありません。</span>
        </footer>
      </div>
    </main>
  );
}
