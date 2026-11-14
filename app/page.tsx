"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "./components/AppHeader";
import DailyReview from "./components/DailyReview";
import RecallControls from "./components/RecallControls";
import { SpeechSettings, useSpeech } from "./speech";
import { useRecallStatuses } from "./recall";
import type { Story, StorySummary } from "../lib/models";

type Level = Story["level"];

function getStoryParts(text: string, terms: string[]) {
  const escaped = terms
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
  const parts: Array<{ text: string; term?: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    parts.push({ text: match[0], term: match[0].toLowerCase() });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

function shuffle<T,>(items: T[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function Home() {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [storyError, setStoryError] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<Level>("中学");
  const [selectedStoryId, setSelectedStoryId] = useState("");
  const [selectedTerm, setSelectedTerm] = useState("");
  const [quizQuestion, setQuizQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizReview, setQuizReview] = useState<Array<{ term: string; correct: boolean }>>([]);
  const { statuses: recallStatuses, setStatus: setRecallStatus, storageMessage, progress, userId } = useRecallStatuses();
  const speech = useSpeech();
  const speakForReview = useCallback((text: string, label: string) => speech.speak(text, label), [speech.speak]);

  useEffect(() => {
    let active = true;
    fetch("/api/stories?summary=true", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          throw new Error(data.error ?? "ストーリーを読み込めませんでした。");
        }
        return response.json() as Promise<{ stories: StorySummary[] }>;
      })
      .then(({ stories: loadedStories }) => {
        if (!active) return;
        setStories(loadedStories);
        const selected = loadedStories.find((item) => item.level === selectedLevel) ?? loadedStories[0];
        if (selected) {
          setSelectedLevel(selected.level);
          setSelectedStoryId(selected.id);
        }
      })
      .catch((error: unknown) => {
        if (active) setStoryError(error instanceof Error ? error.message : "ストーリーを読み込めませんでした。");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedStoryId) return;
    const controller = new AbortController();
    setSelectedStory(null);
    setStoryError("");
    fetch(`/api/stories/${encodeURIComponent(selectedStoryId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          throw new Error(data.error ?? "ストーリーを読み込めませんでした。");
        }
        return response.json() as Promise<{ story: Story }>;
      })
      .then(({ story }) => {
        setSelectedStory(story);
        setSelectedTerm(story.targetTerms[0] ?? "");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setStoryError(error instanceof Error ? error.message : "ストーリーを読み込めませんでした。");
      });
    return () => controller.abort();
  }, [selectedStoryId]);

  const levelStories = stories.filter((item) => item.level === selectedLevel);
  const storyText = selectedStory?.paragraphs.join("\n\n") ?? "";
  const storyWords = storyText.trim() ? storyText.trim().split(/\s+/).length : 0;
  const targetVocabulary = selectedStory?.targetVocabulary ?? [];
  const storyParts = useMemo(
    () => selectedStory?.paragraphs.map((paragraph) => getStoryParts(paragraph, selectedStory.targetTerms)) ?? [],
    [selectedStory],
  );
  const quizWords = useMemo(() => shuffle(targetVocabulary), [selectedStory?.id, quizStarted]);
  const currentQuestion = quizWords[quizQuestion];
  const quizQuestionCount = Math.min(5, quizWords.length);
  const options = useMemo(() => {
    if (!currentQuestion) return [];
    const wrongAnswers = shuffle(targetVocabulary.filter((item) => item.term !== currentQuestion.term)).slice(0, 3);
    return shuffle([currentQuestion, ...wrongAnswers]);
  }, [currentQuestion, quizQuestion, targetVocabulary]);

  const selectedVocabulary = targetVocabulary.find((item) => item.term === selectedTerm)
    ?? targetVocabulary[0];
  const learnedCount = progress.learnedCount;

  if (!selectedStory || !selectedVocabulary) {
    return (
      <main className="app-shell">
        <AppHeader active="story" />
        <div className="page-content page-message" role={storyError ? "alert" : "status"}>
          {storyError || "ストーリーを読み込んでいます…"}
        </div>
      </main>
    );
  }

  function chooseLevel(level: Level) {
    const firstStory = stories.find((item) => item.level === level);
    if (!firstStory) return;
    setSelectedLevel(level);
    setSelectedStoryId(firstStory.id);
    resetQuiz();
  }

  function chooseStory(storyId: string) {
    const nextStory = stories.find((item) => item.id === storyId);
    if (!nextStory) return;
    setSelectedStoryId(nextStory.id);
    resetQuiz();
  }

  function resetQuiz() {
    setQuizStarted(false);
    setQuizFinished(false);
    setQuizQuestion(0);
    setSelectedAnswer(null);
    setAnswerSubmitted(false);
    setScore(0);
    setQuizReview([]);
  }

  function startQuiz() {
    setQuizStarted(true);
    setQuizFinished(false);
    setQuizQuestion(0);
    setSelectedAnswer(null);
    setAnswerSubmitted(false);
    setScore(0);
    setQuizReview([]);
  }

  function submitAnswer() {
    if (!selectedAnswer || !currentQuestion || answerSubmitted) return;
    const isCorrect = selectedAnswer === currentQuestion.term;
    setQuizReview((previous) => [...previous, { term: currentQuestion.term, correct: isCorrect }]);
    if (isCorrect) setScore((value) => value + 1);
    setAnswerSubmitted(true);
  }

  function continueQuiz() {
    if (!answerSubmitted) return;
    if (quizQuestion + 1 >= quizQuestionCount) {
      setQuizFinished(true);
      return;
    }
    setSelectedAnswer(null);
    setAnswerSubmitted(false);
    setQuizQuestion((value) => value + 1);
  }

  return (
    <main className="app-shell">
      <AppHeader active="story" />
      <div className="page-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span>READ</span> · <span>LEARN</span> · <span>GROW</span></p>
            <h1>毎日5分、<br /><span>英語の世界がひらく。</span></h1>
            <p className="hero-description">物語・音声・間隔復習で、覚えた言葉を「使える英語」へ。</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="sun" /><div className="hill hill-back" /><div className="hill hill-front" />
            <div className="open-book"><span /><span /></div>
            <div className="sparkle sparkle-one">✳</div><div className="sparkle sparkle-two">✦</div>
          </div>
        </section>

        <section className="story-select-card card" aria-label="ストーリーを選択">
          <div className="select-field">
            <label htmlFor="level-select">レベル</label>
            <select id="level-select" value={selectedLevel} onChange={(event) => chooseLevel(event.target.value as Level)}>
              <option value="中学">中学レベル</option>
              <option value="高校">高校レベル</option>
            </select>
          </div>
          <div className="select-field story-select-field">
            <label htmlFor="story-select">章・ストーリー</label>
            <select id="story-select" value={selectedStory.id} onChange={(event) => chooseStory(event.target.value)}>
              {levelStories.map((item) => <option value={item.id} key={item.id}>第{item.chapter}章：{item.title}</option>)}
            </select>
          </div>
          <span className="story-select-count">{levelStories.length}章</span>
        </section>

        <div className="learning-layout">
          <section className="story-card card" aria-labelledby="story-title">
            <div className="card-heading">
              <div>
                <p className="section-kicker">TODAY&apos;S STORY <span>{String(selectedStory.chapter).padStart(2, "0")}</span></p>
                <h2 id="story-title">{selectedStory.title}</h2>
              </div>
              <span className="level-pill">{selectedStory.level}レベル</span>
            </div>
            <div className="story-meta">
              <span><span className="meta-icon">◷</span> {selectedStory.readingTime}</span>
              <span className="meta-divider" /><span>{storyWords} words</span><span className="meta-divider" />
              <button className="story-speech-button" type="button" onClick={() => speech.speak(storyText, "ストーリー")} aria-label="ストーリー全体を英語で読み上げる">
                <span aria-hidden="true">🔊</span> 読み上げ
              </button>
              <span className="target-hint"><span className="hint-dot" /> 色のついた単語をタップ</span>
            </div>
            <div className="story-text">
              {storyParts.map((parts, paragraphIndex) => (
                <p key={paragraphIndex}>
                  {parts.map((part, partIndex) => {
                    if (!part.term) return <span key={partIndex}>{part.text}</span>;
                    const status = recallStatuses[part.term];
                    return (
                      <span className="word-with-audio" key={`${part.term}-${partIndex}`}>
                        <button
                          className={`word-link${selectedTerm === part.term ? " is-selected" : ""}${status === "unsure" ? " marked-unsure" : status === "learned" ? " marked-learned" : ""}`}
                          onClick={() => setSelectedTerm(part.term!)}
                          aria-label={`${part.text}: ${targetVocabulary.find((item) => item.term === part.term)?.meaning ?? ""}${status === "unsure" ? "、まだ不安" : status === "learned" ? "、覚えた" : ""}`}
                        >{part.text}</button>
                        <button className="inline-speech-button" type="button" onClick={() => speech.speak(part.text, part.text)} aria-label={`${part.text}を読み上げる`}>
                          <span aria-hidden="true">🔊</span>
                        </button>
                      </span>
                    );
                  })}
                </p>
              ))}
            </div>
            <div className="story-footer">
              <span className="leaf-icon" aria-hidden="true">✳</span>
              <span>知らない単語も、物語の流れから想像してみよう。語句の状態は自動で保存されます。</span>
            </div>
            <p className="speech-status" aria-live="polite">{speech.message}</p>
          </section>

          <aside className="word-panel card" aria-live="polite" aria-labelledby="word-panel-title">
            <div className="panel-title-row">
              <div><p className="section-kicker">WORD NOTE</p><h2 id="word-panel-title">ことばメモ</h2></div>
              <span className="note-icon" aria-hidden="true">✎</span>
            </div>
            <div className="selected-word">
              <span className="word-level">{selectedVocabulary.level}レベル</span>
              <div className="word-title-row">
                <h3>{selectedVocabulary.term}</h3>
                <button className="word-speech-button" type="button" onClick={() => speech.speak(selectedVocabulary.term, selectedVocabulary.term)} aria-label={`${selectedVocabulary.term}を読み上げる`}>
                  <span aria-hidden="true">🔊</span>
                </button>
              </div>
              <p className="word-pronunciation">{selectedVocabulary.pronunciation}</p>
              <p className="word-meaning">{selectedVocabulary.meaning}</p>
              <div className="importance">
                <span>重要度</span>
                <span className="importance-stars" aria-label={`重要度 ${selectedVocabulary.importance} / 3`}>
                  {"★".repeat(selectedVocabulary.importance)}<span>{"★".repeat(3 - selectedVocabulary.importance)}</span>
                </span>
              </div>
            </div>
            <div className="recall-section">
              <p className="detail-label">この単語の状態</p>
              <RecallControls status={recallStatuses[selectedVocabulary.term]} onChange={(status) => setRecallStatus(selectedVocabulary.term, status)} />
            </div>
            <div className="translation-box"><p className="detail-label">この物語では</p><p>「{selectedVocabulary.translation}」</p></div>
            <div className="example-box">
              <p className="detail-label">例文</p>
              <p className="example-english">{selectedVocabulary.example}</p>
              <p className="example-japanese">{selectedVocabulary.exampleTranslation}</p>
            </div>
            <SpeechSettings controller={speech} />
            <div className="vocab-progress">
              <div className="progress-label"><span>覚えた単語</span><strong>{learnedCount} / {progress.vocabularyCount}語</strong></div>
              <div className="progress-track"><span style={{ width: `${progress.vocabularyCount ? (learnedCount / progress.vocabularyCount) * 100 : 0}%` }} /></div>
            </div>
            {storageMessage && <p className="storage-message" role="status">{storageMessage}</p>}
            <a className="wordbook-shortcut" href="/wordbook">単語帳で全ての語彙を見る →</a>
          </aside>
        </div>

        <section className="quiz-section card" aria-labelledby="quiz-title">
          <div className="quiz-intro">
            <div className="quiz-icon" aria-hidden="true"><span>?</span></div>
            <div><p className="section-kicker">LET&apos;S REVIEW</p><h2 id="quiz-title">読んだあとに、ミニ復習。</h2><p>このストーリーの単語から意味を4択でチェックしよう。</p></div>
          </div>
          <div className="quiz-content">
            {!quizStarted ? (
              <div className="quiz-start">
                <span>全{Math.min(5, targetVocabulary.length)}問 · 選択中ストーリーから出題</span>
                <button className="primary-button" onClick={startQuiz}>クイズに挑戦 <span aria-hidden="true">→</span></button>
              </div>
            ) : quizFinished ? (
              <div className="quiz-result" aria-live="polite">
                <div>
                  <span className="result-label">YOUR RESULT</span>
                  <p className="result-score"><strong>{score}</strong><span> / {Math.min(5, quizWords.length)} 問正解</span></p>
                  <p className="result-message">{score === quizQuestionCount ? "すばらしい！単語マスターです。" : score >= Math.ceil(quizQuestionCount * 0.6) ? "いい調子！もう少しで満点です。" : "物語をもう一度読んで、再挑戦してみよう。"}</p>
                </div>
                <button className="primary-button" onClick={startQuiz}>もう一度挑戦 <span aria-hidden="true">↻</span></button>
                <div className="quiz-review-list">
                  <p className="detail-label">今回の単語をふりかえろう</p>
                  {quizReview.map((answer) => {
                    const item = targetVocabulary.find((word) => word.term === answer.term);
                    if (!item) return null;
                    return (
                      <div className="quiz-review-item" key={answer.term}>
                        <div className="quiz-review-word"><strong>{item.term}</strong><span className={answer.correct ? "correct-label" : "incorrect-label"}>{answer.correct ? "正解" : "もう一度"}</span><span>{item.meaning}</span></div>
                        <RecallControls status={recallStatuses[item.term]} onChange={(status) => setRecallStatus(item.term, status)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="quiz-question" aria-live="polite">
                <div className="question-top">
                  <span className="question-count">QUESTION <strong>{quizQuestion + 1}</strong> <span>/ {quizQuestionCount}</span></span>
                  <div className="question-progress" aria-label={`${quizQuestionCount}問中${quizQuestion + 1}問目`}>
                    {Array.from({ length: quizQuestionCount }, (_, i) => <span className={i <= quizQuestion ? "active" : ""} key={i} />)}
                  </div>
                </div>
                <p className="question-prompt"><strong>{currentQuestion?.term}</strong> の意味は？</p>
                <div className="answer-grid">
                  {options.map((option, index) => (
                    <button key={option.term} className={`answer-option${selectedAnswer === option.term ? " selected" : ""}`} onClick={() => setSelectedAnswer(option.term)} aria-pressed={selectedAnswer === option.term} disabled={answerSubmitted}>
                      <span className="answer-letter">{String.fromCharCode(65 + index)}</span>{option.meaning}
                    </button>
                  ))}
                </div>
                {answerSubmitted && currentQuestion && (
                  <div className={`review-feedback${selectedAnswer === currentQuestion.term ? " is-correct" : " is-incorrect"}`} aria-live="polite">
                    <strong>{selectedAnswer === currentQuestion.term ? "正解です！" : `正解は「${currentQuestion.meaning}」です。`}</strong>
                    <p>{currentQuestion.example}</p>
                    <span>{currentQuestion.exampleTranslation}</span>
                    <RecallControls status={recallStatuses[currentQuestion.term]} onChange={(status) => setRecallStatus(currentQuestion.term, status)} />
                  </div>
                )}
                <div className="question-actions">
                  <span>{answerSubmitted ? "答えと例文を確認してから進もう" : "選択肢を選んで答え合わせ"}</span>
                  <button className="primary-button" onClick={answerSubmitted ? continueQuiz : submitAnswer} disabled={!answerSubmitted && !selectedAnswer}>
                    {answerSubmitted ? (quizQuestion + 1 >= quizQuestionCount ? "結果を見る" : "次の問題へ") : "答え合わせ"} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
        <DailyReview
          userId={userId}
          statuses={recallStatuses}
          onStatusChange={(term, status) => void setRecallStatus(term, status)}
          onSpeak={speakForReview}
        />
        <footer className="page-footer">
          <span>Bloom English</span>
          <span>CEFR-J Wordlist A1/A2を参考に編集した語彙を含みます。現行教科書の全語彙を網羅する公式リストではありません。</span>
        </footer>
      </div>
    </main>
  );
}
