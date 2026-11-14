"use client";

import { useEffect, useMemo, useState } from "react";
import type { RecallStatus, Vocabulary, VocabularyLevel } from "../../lib/models";
import type { RecallStatuses } from "../recall";

type ReviewItem = Pick<Vocabulary, "term" | "level" | "meaning" | "translation" | "pronunciation" | "example" | "exampleTranslation" | "importance"> & {
  status?: RecallStatus;
};
type StudyGoal = "junior-entrance" | "university-entrance" | "all";
type ReviewMode = "meaning" | "listening" | "spelling" | "diagnostic";
type Rating = "again" | "hard" | "good" | "easy";
type WeekDay = { date: string; count: number };
type LevelProgress = { level: VocabularyLevel; total: number; learned: number; due: number };
type StudyStats = {
  todayCount: number;
  dailyGoal: number;
  streakDays: number;
  studyGoal: StudyGoal;
  weeklyActivity: WeekDay[];
};

const goalDescriptions: Record<StudyGoal, string> = {
  "junior-entrance": "中学レベルの語彙を中心に、高校受験の土台をつくります。",
  "university-entrance": "高校レベルの収録語彙を中心に、大学受験の基礎を固めます。",
  all: "中学・高校の全収録語彙から出題します。",
};
const goalLabels: Record<StudyGoal, string> = {
  "junior-entrance": "中学・高校受験",
  "university-entrance": "高校・大学受験",
  all: "全収録語彙",
};
const ratingLabels: Array<{ value: Rating; label: string; hint: string }> = [
  { value: "again", label: "もう一度", hint: "10分後に復習" },
  { value: "hard", label: "難しかった", hint: "明日もう一度" },
  { value: "good", label: "思い出せた", hint: "間隔をあけて復習" },
  { value: "easy", label: "かんたん", hint: "長めに間隔をあける" },
];

function shuffle<T,>(items: T[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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

function normalizeSpelling(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getWeekLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("ja-JP", { weekday: "short" });
}

export default function DailyReview({
  userId,
  statuses,
  onStatusChange,
  onSpeak,
}: {
  userId: string;
  statuses: RecallStatuses;
  onStatusChange: (term: string, status: RecallStatus) => void;
  onSpeak: (text: string, label: string) => void;
}) {
  const [level, setLevel] = useState<"すべて" | VocabularyLevel>("すべて");
  const [mode, setMode] = useState<ReviewMode>("meaning");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [studyStats, setStudyStats] = useState<StudyStats>({
    todayCount: 0,
    dailyGoal: 5,
    streakDays: 0,
    studyGoal: "junior-entrance",
    weeklyActivity: [],
  });
  const [levelProgress, setLevelProgress] = useState<LevelProgress[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [studyError, setStudyError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [spellingAnswer, setSpellingAnswer] = useState("");
  const [answered, setAnswered] = useState(false);
  const [reviewRecorded, setReviewRecorded] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [score, setScore] = useState(0);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<Array<{ level: VocabularyLevel; correct: boolean }>>([]);

  const today = getJapanDate();

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ userId, date: today });
    Promise.all([
      fetch(`/api/study?${params}`, { cache: "no-store", signal: controller.signal }),
      fetch(`/api/progress?userId=${encodeURIComponent(userId)}`, { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([studyResponse, progressResponse]) => {
        if (!studyResponse.ok) {
          const data = await studyResponse.json() as { error?: string };
          throw new Error(data.error ?? "今日の学習状況を読み込めませんでした。");
        }
        if (!progressResponse.ok) {
          const data = await progressResponse.json() as { error?: string };
          throw new Error(data.error ?? "学習の進み具合を読み込めませんでした。");
        }
        const stats = await studyResponse.json() as StudyStats;
        const progress = await progressResponse.json() as { dueCount: number; byLevel: LevelProgress[] };
        setStudyStats(stats);
        setDueCount(progress.dueCount);
        setLevelProgress(progress.byLevel);
        setStudyError("");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStudyError(error instanceof Error ? error.message : "学習状況を読み込めませんでした。");
      });
    return () => controller.abort();
  }, [today, userId]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ userId });
    if (mode === "diagnostic") {
      params.set("mode", "diagnostic");
    } else {
      const courseLevel = studyStats.studyGoal === "junior-entrance"
        ? "中学"
        : studyStats.studyGoal === "university-entrance"
          ? "高校"
          : undefined;
      const selectedLevel = level === "すべて" ? courseLevel : level;
      if (selectedLevel) params.set("level", selectedLevel);
    }
    setLoading(true);
    fetch(`/api/vocabulary/review?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          throw new Error(data.error ?? "復習語を読み込めませんでした。");
        }
        return response.json() as Promise<{ items: ReviewItem[] }>;
      })
      .then(({ items: loadedItems }) => {
        setItems(loadedItems);
        setLoadError("");
        setStarted(false);
        setFinished(false);
        setQuestionIndex(0);
        setSelectedAnswer(null);
        setSpellingAnswer("");
        setAnswered(false);
        setReviewRecorded(false);
        setScore(0);
        setDiagnosticAnswers([]);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "復習語を読み込めませんでした。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [level, mode, refreshKey, studyStats.studyGoal, userId]);

  const questions = useMemo(() => {
    if (mode !== "diagnostic") return items.slice(0, 5);
    const middle = shuffle(items.filter((item) => item.level === "中学")).slice(0, 5);
    const high = shuffle(items.filter((item) => item.level === "高校")).slice(0, 5);
    return shuffle([...middle, ...high]);
  }, [items, mode]);
  const currentQuestion = questions[questionIndex];
  const options = useMemo(() => {
    if (!currentQuestion) return [];
    const wrongAnswers = shuffle(items.filter((item) => item.term !== currentQuestion.term)).slice(0, 3);
    return shuffle([currentQuestion, ...wrongAnswers]);
  }, [currentQuestion, items]);
  const isCorrect = mode === "spelling"
    ? normalizeSpelling(spellingAnswer) === normalizeSpelling(currentQuestion?.term ?? "")
    : selectedAnswer === currentQuestion?.term;

  useEffect(() => {
    if (started && mode === "listening" && currentQuestion && !answered) {
      onSpeak(currentQuestion.term, currentQuestion.term);
    }
  }, [answered, currentQuestion, mode, onSpeak, started]);

  async function updateSettings(changes: { dailyGoal?: number; studyGoal?: StudyGoal }) {
    setStudyError("");
    try {
      const response = await fetch("/api/study", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...changes }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "学習設定を保存できませんでした。");
      }
      setStudyStats(await response.json() as StudyStats);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setStudyError(error instanceof Error ? error.message : "学習設定を保存できませんでした。");
    }
  }

  function startReview() {
    setStarted(true);
    setFinished(false);
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setSpellingAnswer("");
    setAnswered(false);
    setReviewRecorded(false);
    setScheduleMessage("");
    setScore(0);
    setDiagnosticAnswers([]);
  }

  async function recordSchedule(rating: Rating, correct: boolean, term: string) {
    const response = await fetch("/api/vocabulary/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, term, rating, correct }),
    });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? "次回の復習予定を保存できませんでした。");
    }
    const schedule = await response.json() as { nextReviewAt: string };
    const interval = rating === "again"
      ? "約10分後"
      : `約${Math.max(1, Math.round((new Date(schedule.nextReviewAt).getTime() - Date.now()) / 86400000))}日後`;
    setScheduleMessage(`${interval}にもう一度出題します。`);
    setReviewRecorded(true);
    const status: RecallStatus = rating === "again" || rating === "hard" ? "unsure" : "learned";
    onStatusChange(term, status);
  }

  async function submitAnswer() {
    if (!currentQuestion || answered) return;
    if (mode !== "spelling" && !selectedAnswer) return;
    const correct = mode === "spelling"
      ? normalizeSpelling(spellingAnswer) === normalizeSpelling(currentQuestion.term)
      : selectedAnswer === currentQuestion.term;
    setAnswered(true);
    setReviewRecorded(false);
    setScheduleMessage("");
    setStudyError("");
    if (correct) setScore((value) => value + 1);
    if (mode === "diagnostic") {
      setDiagnosticAnswers((previous) => [...previous, { level: currentQuestion.level, correct }]);
    }

    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, date: getJapanDate() }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "今日の学習状況を保存できませんでした。");
      }
      setStudyStats(await response.json() as StudyStats);
    } catch (error) {
      setStudyError(error instanceof Error ? error.message : "今日の学習状況を保存できませんでした。");
    }

    if (mode === "diagnostic") {
      try {
        await recordSchedule(correct ? "good" : "again", correct, currentQuestion.term);
      } catch (error) {
        setStudyError(error instanceof Error ? error.message : "診断結果を保存できませんでした。");
      }
    }
  }

  async function rateAnswer(rating: Rating) {
    if (!currentQuestion || reviewRecorded) return;
    setStudyError("");
    try {
      await recordSchedule(rating, isCorrect, currentQuestion.term);
    } catch (error) {
      setStudyError(error instanceof Error ? error.message : "次回の復習予定を保存できませんでした。");
    }
  }

  function continueReview() {
    if (!reviewRecorded) return;
    if (questionIndex + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setQuestionIndex((value) => value + 1);
    setSelectedAnswer(null);
    setSpellingAnswer("");
    setAnswered(false);
    setReviewRecorded(false);
    setScheduleMessage("");
  }

  const diagnosticTotals = diagnosticAnswers.reduce(
    (totals, answer) => {
      const key = answer.level === "中学" ? "middle" : "high";
      totals[key].total += 1;
      if (answer.correct) totals[key].correct += 1;
      return totals;
    },
    { middle: { total: 0, correct: 0 }, high: { total: 0, correct: 0 } },
  );
  const middleAccuracy = diagnosticTotals.middle.total
    ? diagnosticTotals.middle.correct / diagnosticTotals.middle.total
    : 0;
  const highAccuracy = diagnosticTotals.high.total
    ? diagnosticTotals.high.correct / diagnosticTotals.high.total
    : 0;
  const recommendedGoal: StudyGoal = middleAccuracy < 0.6
    ? "junior-entrance"
    : highAccuracy < 0.6
      ? "university-entrance"
      : "all";
  const maxDailyCount = Math.max(studyStats.dailyGoal, ...studyStats.weeklyActivity.map((day) => day.count), 1);

  return (
    <section className="quiz-section card daily-review-section" aria-labelledby="daily-review-title">
      <div className="quiz-intro daily-review-intro">
        <div className="quiz-icon" aria-hidden="true"><span>✦</span></div>
        <div>
          <p className="section-kicker">SMART REVIEW</p>
          <h2 id="daily-review-title">今日の学習プラン</h2>
          <p>忘れる前に思い出す、間隔反復で定着をサポート。</p>
          <label className="daily-review-level">
            <span>コース</span>
            <select value={studyStats.studyGoal} onChange={(event) => void updateSettings({ studyGoal: event.target.value as StudyGoal })}>
              <option value="junior-entrance">中学・高校受験</option>
              <option value="university-entrance">高校・大学受験</option>
              <option value="all">全収録語彙</option>
            </select>
          </label>
          <p className="course-description">{goalDescriptions[studyStats.studyGoal]}</p>
          <label className="daily-review-level daily-goal-select">
            <span>1日の目標</span>
            <select value={studyStats.dailyGoal} onChange={(event) => void updateSettings({ dailyGoal: Number(event.target.value) })}>
              {[3, 5, 10, 15, 20].map((count) => <option value={count} key={count}>{count}問</option>)}
            </select>
          </label>
          <div className="daily-review-stats">
            <strong>{studyStats.todayCount} / {studyStats.dailyGoal} 問</strong>
            <span>{dueCount}語が復習どき · {studyStats.streakDays}日連続</span>
          </div>
          <div className="progress-track"><span style={{ width: `${Math.min(100, (studyStats.todayCount / studyStats.dailyGoal) * 100)}%` }} /></div>
        </div>
      </div>
      <div className="weekly-progress">
        <div className="weekly-progress-heading">
          <div><p className="section-kicker">YOUR RHYTHM</p><h3>今週の学習</h3></div>
          <span>{studyStats.weeklyActivity.reduce((sum, day) => sum + day.count, 0)}問</span>
        </div>
        <div className="weekly-chart" aria-label="過去7日間の学習問題数">
          {studyStats.weeklyActivity.map((day) => (
            <div className="weekly-day" key={day.date} aria-label={`${day.date}: ${day.count}問`}>
              <span className="weekly-bar-track"><span style={{ height: `${Math.max(day.count ? 8 : 0, (day.count / maxDailyCount) * 100)}%` }} /></span>
              <span className="weekly-day-label">{getWeekLabel(day.date)}</span>
              <span className="weekly-day-count">{day.count || ""}</span>
            </div>
          ))}
        </div>
        <div className="level-progress-list">
          {levelProgress.map((item) => (
            <div className="level-progress-row" key={item.level}>
              <span>{item.level}語彙</span>
              <span className="level-progress-track"><span style={{ width: `${item.total ? (item.learned / item.total) * 100 : 0}%` }} /></span>
              <strong>{item.learned}/{item.total}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="quiz-content daily-review-content">
        {loadError ? (
          <div className="daily-review-message" role="alert">
            <p>{loadError}</p>
            <button type="button" className="primary-button" onClick={() => setRefreshKey((value) => value + 1)}>再読み込み</button>
          </div>
        ) : loading || !userId ? (
          <p className="daily-review-message" role="status">復習語を読み込んでいます…</p>
        ) : !items.length ? (
          <div className="daily-review-message" role="status">
            <p>{mode === "diagnostic" ? "診断できる単語がありません。" : "今のコースに復習どきの単語はありません。新しい単語か診断テストに挑戦してみましょう。"}</p>
            <button type="button" className="primary-button" onClick={() => { setMode("diagnostic"); setRefreshKey((value) => value + 1); }}>レベル診断へ</button>
          </div>
        ) : !started ? (
          <div className="quiz-start daily-review-start">
            <div className="review-mode-controls">
              <label className="filter-field">
                <span>練習モード</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as ReviewMode)}>
                  <option value="meaning">意味を選ぶ</option>
                  <option value="listening">音を聞く</option>
                  <option value="spelling">スペルを書く</option>
                  <option value="diagnostic">レベル診断</option>
                </select>
              </label>
              {mode !== "diagnostic" && (
                <label className="filter-field">
                  <span>語彙レベル</span>
                  <select value={level} onChange={(event) => setLevel(event.target.value as "すべて" | VocabularyLevel)}>
                    <option value="すべて">コースに合わせる</option>
                    <option value="中学">中学レベル</option>
                    <option value="高校">高校レベル</option>
                  </select>
                </label>
              )}
            </div>
            <p className="quiz-start-caption">
              {mode === "diagnostic"
                ? `中学・高校レベルを各5問、全${questions.length}問でチェック`
                : mode === "spelling"
                  ? `全${questions.length}問 · 意味を見てスペルを入力`
                  : mode === "listening"
                    ? `全${questions.length}問 · 音声を聞いて意味を選ぶ`
                    : `全${questions.length}問 · まず思い出してから答える`}
            </p>
            <button className="primary-button" type="button" onClick={startReview}>学習を始める <span aria-hidden="true">→</span></button>
          </div>
        ) : finished ? (
          <div className="quiz-result daily-review-result" aria-live="polite">
            <div>
              <span className="result-label">{mode === "diagnostic" ? "LEVEL CHECK" : "TODAY'S REVIEW"}</span>
              <p className="result-score"><strong>{score}</strong><span> / {questions.length} 問正解</span></p>
              {mode === "diagnostic" ? (
                <div className="diagnostic-result">
                  <p>中学 {diagnosticTotals.middle.correct}/{diagnosticTotals.middle.total} · 高校 {diagnosticTotals.high.correct}/{diagnosticTotals.high.total}</p>
                  <p className="result-message">おすすめ: {goalLabels[recommendedGoal]}</p>
                  <button className="secondary-button" type="button" onClick={() => void updateSettings({ studyGoal: recommendedGoal })}>おすすめコースに設定</button>
                </div>
              ) : (
                <p className="result-message">{studyStats.todayCount >= studyStats.dailyGoal ? "今日の目標達成！続けた自分をほめよう。" : "復習完了！今日の目標まであと少しです。"}</p>
              )}
            </div>
            <button className="primary-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>別の単語で復習 <span aria-hidden="true">↻</span></button>
          </div>
        ) : currentQuestion ? (
          <div className="quiz-question" aria-live="polite">
            <div className="question-top">
              <span className="question-count">QUESTION <strong>{questionIndex + 1}</strong> <span>/ {questions.length}</span></span>
              <div className="question-progress" aria-label={`${questions.length}問中${questionIndex + 1}問目`}>
                {questions.map((item, index) => <span className={index <= questionIndex ? "active" : ""} key={`${item.term}-${index}`} />)}
              </div>
            </div>
            {mode === "spelling" ? (
              <>
                <p className="question-prompt">この意味の英単語を入力しよう</p>
                <p className="spelling-meaning">{currentQuestion.meaning}</p>
                <input
                  className="spelling-input"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={spellingAnswer}
                  onChange={(event) => setSpellingAnswer(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !answered) void submitAnswer(); }}
                  disabled={answered}
                  aria-label="英単語のスペル"
                />
              </>
            ) : mode === "listening" ? (
              <>
                <p className="question-prompt">音声を聞いて、意味を選ぼう</p>
                <div className="listening-prompt">
                  <button className="listen-again-button" type="button" onClick={() => onSpeak(currentQuestion.term, currentQuestion.term)}>🔊 もう一度聞く</button>
                  {currentQuestion.pronunciation && <span>{currentQuestion.pronunciation}</span>}
                </div>
              </>
            ) : (
              <p className="question-prompt">
                {mode === "diagnostic" ? <><span className="level-pill">{currentQuestion.level}レベル</span> </> : null}
                <strong>{currentQuestion.term}</strong> の意味は？
                {mode === "meaning" && currentQuestion.pronunciation && <span className="question-pronunciation">{currentQuestion.pronunciation}</span>}
              </p>
            )}
            {mode !== "spelling" && (
              <div className="answer-grid">
                {options.map((option, index) => (
                  <button
                    type="button"
                    key={option.term}
                    className={`answer-option${selectedAnswer === option.term ? " selected" : ""}`}
                    onClick={() => setSelectedAnswer(option.term)}
                    aria-pressed={selectedAnswer === option.term}
                    disabled={answered}
                  >
                    <span className="answer-letter">{String.fromCharCode(65 + index)}</span>{option.meaning}
                  </button>
                ))}
              </div>
            )}
            {answered && (
              <div className={`review-feedback${isCorrect ? " is-correct" : " is-incorrect"}`} aria-live="polite">
                <strong>{isCorrect ? "正解です！" : mode === "spelling" ? `正解は「${currentQuestion.term}」です。` : `正解は「${currentQuestion.meaning}」です。`}</strong>
                {mode === "spelling" && <p className="feedback-pronunciation">{currentQuestion.pronunciation}</p>}
                <p>{currentQuestion.example}</p>
                <span>{currentQuestion.exampleTranslation}</span>
                {mode === "diagnostic" ? (
                  reviewRecorded ? <p className="schedule-message">診断結果を保存しました。</p> : <button className="secondary-button" type="button" onClick={() => void recordSchedule(isCorrect ? "good" : "again", isCorrect, currentQuestion.term)}>診断結果を保存</button>
                ) : (
                  <div className="review-rating-controls" aria-label="思い出しやすさを評価">
                    <span>どのくらい思い出せた？</span>
                    <div>
                      {ratingLabels.map((rating) => (
                        <button
                          className={`rating-button rating-${rating.value}`}
                          type="button"
                          key={rating.value}
                          onClick={() => void rateAnswer(rating.value)}
                          disabled={reviewRecorded}
                        >
                          <strong>{rating.label}</strong><small>{rating.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {scheduleMessage && <p className="schedule-message">{scheduleMessage}</p>}
              </div>
            )}
            {studyError && <p className="storage-message" role="alert">{studyError}</p>}
            <div className="question-actions">
              <span>{answered ? (reviewRecorded ? "復習予定を記録しました" : mode === "diagnostic" ? "診断結果を保存してください" : "思い出しやすさを評価してから進もう") : "答えを選んで確認しよう"}</span>
              <button
                className="primary-button"
                type="button"
                onClick={answered ? continueReview : submitAnswer}
                disabled={answered ? !reviewRecorded : mode === "spelling" ? !spellingAnswer.trim() : !selectedAnswer}
              >
                {answered ? (questionIndex + 1 >= questions.length ? "結果を見る" : "次の問題へ") : "答え合わせ"} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {studyError && !started && <p className="daily-review-error" role="alert">{studyError}</p>}
      <p className="daily-review-disclaimer">収録語彙をレベル別に出題します。現行教科書・受験範囲の完全網羅を示すものではありません。</p>
    </section>
  );
}
