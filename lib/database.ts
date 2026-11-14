import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Story, StorySummary, Vocabulary, VocabularyLevel } from "./models";

const databasePath = resolve(process.env.DATABASE_PATH ?? join(process.cwd(), "data", "learning.sqlite"));
const globalDatabase = globalThis as typeof globalThis & { learningDatabase?: DatabaseSync };

export function getDatabase() {
  if (globalDatabase.learningDatabase) return globalDatabase.learningDatabase;
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  initializeSchema(db);
  globalDatabase.learningDatabase = db;
  return db;
}

export function initializeSchema(db: DatabaseSync = getDatabase()) {
  const hasVocabularyFts = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vocabulary_fts'",
  ).get());
  db.exec("DROP TRIGGER IF EXISTS vocabulary_au");
  db.exec(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id INTEGER PRIMARY KEY,
      vocabulary_key TEXT NOT NULL,
      term TEXT NOT NULL UNIQUE,
      level TEXT NOT NULL CHECK (level IN ('中学', '高校')),
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 3),
      meaning TEXT NOT NULL,
      translation TEXT NOT NULL,
      pronunciation TEXT NOT NULL DEFAULT '',
      example TEXT NOT NULL,
      example_translation TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS vocabulary_level_term_idx ON vocabulary(level, term);
    CREATE INDEX IF NOT EXISTS vocabulary_term_idx ON vocabulary(term);

    CREATE VIRTUAL TABLE IF NOT EXISTS vocabulary_fts USING fts5(
      term, meaning, translation, example,
      content='vocabulary',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL CHECK (level IN ('中学', '高校')),
      chapter INTEGER NOT NULL CHECK (chapter > 0),
      title TEXT NOT NULL,
      reading_time TEXT NOT NULL,
      paragraphs_json TEXT NOT NULL,
      target_terms_json TEXT NOT NULL,
      target_vocabulary_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(level, chapter)
    );
    CREATE INDEX IF NOT EXISTS stories_level_chapter_idx ON stories(level, chapter);

    CREATE TABLE IF NOT EXISTS story_vocabulary (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (story_id, vocabulary_id),
      UNIQUE (story_id, position)
    );
    CREATE INDEX IF NOT EXISTS story_vocabulary_vocabulary_idx ON story_vocabulary(vocabulary_id, story_id);

    CREATE TABLE IF NOT EXISTS learners (
      id TEXT PRIMARY KEY,
      daily_goal INTEGER NOT NULL DEFAULT 5 CHECK (daily_goal BETWEEN 1 AND 30),
      study_goal TEXT NOT NULL DEFAULT 'junior-entrance'
        CHECK (study_goal IN ('junior-entrance', 'university-entrance', 'all')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_progress (
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('learned', 'unsure')),
      next_review_at TEXT,
      interval_days REAL NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      last_reviewed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (learner_id, vocabulary_id)
    );
    CREATE INDEX IF NOT EXISTS user_progress_status_idx ON user_progress(learner_id, status, vocabulary_id);

    CREATE TABLE IF NOT EXISTS user_study_days (
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      study_date TEXT NOT NULL,
      reviewed_count INTEGER NOT NULL DEFAULT 0 CHECK (reviewed_count >= 0),
      PRIMARY KEY (learner_id, study_date)
    );
  `);

  const vocabularyColumns = new Set((db.prepare("PRAGMA table_info(vocabulary)").all() as Array<{ name: string }>).map(({ name }) => name));
  if (!vocabularyColumns.has("vocabulary_key")) {
    db.exec("ALTER TABLE vocabulary ADD COLUMN vocabulary_key TEXT");
    const rows = db.prepare("SELECT id, term FROM vocabulary WHERE vocabulary_key IS NULL").all() as Array<{ id: number; term: string }>;
    const update = db.prepare("UPDATE vocabulary SET vocabulary_key = ? WHERE id = ?");
    for (const row of rows) update.run(vocabularyIdFromTerm(row.term), row.id);
  }
  if (!vocabularyColumns.has("example_translation")) {
    db.exec("ALTER TABLE vocabulary ADD COLUMN example_translation TEXT NOT NULL DEFAULT ''");
  }
  if (!vocabularyColumns.has("pronunciation")) {
    db.exec("ALTER TABLE vocabulary ADD COLUMN pronunciation TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_key_idx ON vocabulary(vocabulary_key)");

  const learnerColumns = new Set((db.prepare("PRAGMA table_info(learners)").all() as Array<{ name: string }>).map(({ name }) => name));
  if (!learnerColumns.has("daily_goal")) {
    db.exec("ALTER TABLE learners ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 5 CHECK (daily_goal BETWEEN 1 AND 30)");
  }
  if (!learnerColumns.has("study_goal")) {
    db.exec("ALTER TABLE learners ADD COLUMN study_goal TEXT NOT NULL DEFAULT 'junior-entrance' CHECK (study_goal IN ('junior-entrance', 'university-entrance', 'all'))");
  }

  const progressColumns = new Set((db.prepare("PRAGMA table_info(user_progress)").all() as Array<{ name: string }>).map(({ name }) => name));
  if (!progressColumns.has("next_review_at")) db.exec("ALTER TABLE user_progress ADD COLUMN next_review_at TEXT");
  if (!progressColumns.has("interval_days")) db.exec("ALTER TABLE user_progress ADD COLUMN interval_days REAL NOT NULL DEFAULT 0");
  if (!progressColumns.has("repetitions")) db.exec("ALTER TABLE user_progress ADD COLUMN repetitions INTEGER NOT NULL DEFAULT 0");
  if (!progressColumns.has("ease_factor")) db.exec("ALTER TABLE user_progress ADD COLUMN ease_factor REAL NOT NULL DEFAULT 2.5");
  if (!progressColumns.has("last_reviewed_at")) db.exec("ALTER TABLE user_progress ADD COLUMN last_reviewed_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS user_progress_due_idx ON user_progress(learner_id, next_review_at)");

  const storyColumns = new Set((db.prepare("PRAGMA table_info(stories)").all() as Array<{ name: string }>).map(({ name }) => name));
  if (!storyColumns.has("target_vocabulary_ids_json")) {
    db.exec("ALTER TABLE stories ADD COLUMN target_vocabulary_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!hasVocabularyFts) {
    db.exec("INSERT INTO vocabulary_fts(vocabulary_fts) VALUES ('rebuild')");
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS vocabulary_ai AFTER INSERT ON vocabulary BEGIN
      INSERT INTO vocabulary_fts(rowid, term, meaning, translation, example)
      VALUES (new.id, new.term, new.meaning, new.translation, new.example);
    END;
    CREATE TRIGGER IF NOT EXISTS vocabulary_ad AFTER DELETE ON vocabulary BEGIN
      INSERT INTO vocabulary_fts(vocabulary_fts, rowid, term, meaning, translation, example)
      VALUES ('delete', old.id, old.term, old.meaning, old.translation, old.example);
    END;
    CREATE TRIGGER IF NOT EXISTS vocabulary_au AFTER UPDATE ON vocabulary BEGIN
      INSERT INTO vocabulary_fts(vocabulary_fts, rowid, term, meaning, translation, example)
      VALUES ('delete', old.id, old.term, old.meaning, old.translation, old.example);
      INSERT INTO vocabulary_fts(rowid, term, meaning, translation, example)
      VALUES (new.id, new.term, new.meaning, new.translation, new.example);
    END;
  `);
}

type VocabularySeed = Omit<Vocabulary, "id" | "status">;
type StorySeed = Omit<Story, "targetVocabulary">;

function vocabularyIdFromTerm(term: string) {
  return term.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function seedDatabase(
  vocabularyRows: VocabularySeed[],
  storyRows: StorySeed[],
  db: DatabaseSync = getDatabase(),
) {
  const vocabularyUpsert = db.prepare(`
    INSERT INTO vocabulary (vocabulary_key, term, level, importance, meaning, translation, pronunciation, example, example_translation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(term) DO UPDATE SET
      vocabulary_key = excluded.vocabulary_key,
      level = excluded.level, importance = excluded.importance, meaning = excluded.meaning,
      translation = excluded.translation, pronunciation = excluded.pronunciation, example = excluded.example,
      example_translation = excluded.example_translation, updated_at = CURRENT_TIMESTAMP
  `);
  const storyUpsert = db.prepare(`
    INSERT INTO stories (id, level, chapter, title, reading_time, paragraphs_json, target_terms_json, target_vocabulary_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      level = excluded.level, chapter = excluded.chapter, title = excluded.title,
      reading_time = excluded.reading_time, paragraphs_json = excluded.paragraphs_json,
      target_terms_json = excluded.target_terms_json,
      target_vocabulary_ids_json = excluded.target_vocabulary_ids_json, updated_at = CURRENT_TIMESTAMP
  `);
  const linkInsert = db.prepare("INSERT INTO story_vocabulary (story_id, vocabulary_id, position) VALUES (?, ?, ?)");

  db.exec("BEGIN IMMEDIATE");
  try {
    const batchSize = 500;
    for (let offset = 0; offset < vocabularyRows.length; offset += batchSize) {
      const batch = vocabularyRows.slice(offset, offset + batchSize);
      for (const item of batch) {
        vocabularyUpsert.run(
          item.vocabularyId || vocabularyIdFromTerm(item.term),
          item.term,
          item.level,
          item.importance,
          item.meaning,
          item.translation,
          item.pronunciation ?? "",
          item.example,
          item.exampleTranslation ?? "",
        );
      }
    }

    const vocabularyRowsById = db.prepare("SELECT id, vocabulary_key, term FROM vocabulary").all() as Array<{ id: number; vocabulary_key: string; term: string }>;
    const knownIds = new Map(vocabularyRowsById.map((item) => [item.vocabulary_key, item]));
    const knownTerms = new Map(vocabularyRowsById.map((item) => [item.term, item]));
    for (const story of storyRows) {
      const targetVocabularyIds = story.targetVocabularyIds
        ?? story.targetTerms.map((term) => knownTerms.get(term)?.vocabulary_key ?? "");
      const missing = targetVocabularyIds.filter((id) => !knownIds.has(id));
      if (missing.length) {
        throw new Error(`Story "${story.id}" references unknown vocabulary: ${missing.join(", ")}`);
      }
      const targetTerms = targetVocabularyIds.map((id) => knownIds.get(id)!.term);
      if (story.targetTerms.length && story.targetTerms.some((term) => !knownTerms.has(term))) {
        throw new Error(`Story "${story.id}" contains an unknown target term.`);
      }
      storyUpsert.run(
        story.id,
        story.level,
        story.chapter,
        story.title,
        story.readingTime,
        JSON.stringify(story.paragraphs),
        JSON.stringify(targetTerms),
        JSON.stringify(targetVocabularyIds),
      );
      db.prepare("DELETE FROM story_vocabulary WHERE story_id = ?").run(story.id);
      targetVocabularyIds.forEach((vocabularyId, position) => {
        const vocabulary = knownIds.get(vocabularyId)!;
        linkInsert.run(story.id, vocabulary.id, position);
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type StoryRow = {
  id: string;
  level: VocabularyLevel;
  chapter: number;
  title: string;
  readingTime: string;
  paragraphs_json: string;
  target_terms_json: string;
  target_vocabulary_ids_json: string;
};

function mapStory(row: StoryRow, targetVocabulary: Vocabulary[]): Story {
  const targetTerms = targetVocabulary.map((item) => item.term);
  const targetVocabularyIds = targetVocabulary.map((item) => item.vocabularyId);
  return {
    id: row.id,
    level: row.level,
    chapter: row.chapter,
    title: row.title,
    readingTime: row.readingTime,
    paragraphs: JSON.parse(row.paragraphs_json) as string[],
    targetTerms,
    targetVocabularyIds,
    targetVocabulary,
  };
}

export function getStorySummaries(db = getDatabase()): StorySummary[] {
  return db.prepare(`
    SELECT id, level, chapter, title, reading_time AS readingTime
    FROM stories ORDER BY CASE level WHEN '中学' THEN 0 ELSE 1 END, chapter, id
  `).all() as StorySummary[];
}

export function getStoryById(id: string, db = getDatabase()): Story | undefined {
  const row = db.prepare(`
    SELECT id, level, chapter, title, reading_time AS readingTime, paragraphs_json, target_terms_json, target_vocabulary_ids_json
    FROM stories WHERE id = ?
  `).get(id) as StoryRow | undefined;
  if (!row) return undefined;
  const targets = db.prepare(`
    SELECT v.id, v.vocabulary_key AS vocabularyId, v.term, v.level, v.importance, v.meaning,
      v.translation, v.pronunciation, v.example, v.example_translation AS exampleTranslation
    FROM story_vocabulary sv JOIN vocabulary v ON v.id = sv.vocabulary_id
    WHERE sv.story_id = ? ORDER BY sv.position
  `).all(id) as Vocabulary[];
  if (!targets.length) {
    const terms = JSON.parse(row.target_terms_json) as string[];
    const legacy = terms.map((term) => db.prepare(`
      SELECT id, vocabulary_key AS vocabularyId, term, level, importance, meaning, translation,
        pronunciation, example, example_translation AS exampleTranslation FROM vocabulary WHERE term = ?
    `).get(term) as Vocabulary | undefined).filter((item): item is Vocabulary => item !== undefined);
    return mapStory(row, legacy);
  }
  return mapStory(row, targets);
}

export function getStories(db = getDatabase()): Story[] {
  return getStorySummaries(db)
    .map((story) => getStoryById(story.id, db))
    .filter((story): story is Story => story !== undefined);
}

export function closeDatabaseForTests() {
  globalDatabase.learningDatabase?.close();
  delete globalDatabase.learningDatabase;
}

export function getDatabasePath() {
  return databasePath;
}
