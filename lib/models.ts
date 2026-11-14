export type VocabularyLevel = "中学" | "高校";
export type RecallStatus = "learned" | "unsure";

export type Vocabulary = {
  id: number;
  vocabularyId: string;
  term: string;
  level: VocabularyLevel;
  importance: number;
  meaning: string;
  translation: string;
  pronunciation?: string;
  example: string;
  exampleTranslation: string;
  status?: RecallStatus;
};

export type Story = {
  id: string;
  level: VocabularyLevel;
  chapter: number;
  title: string;
  readingTime: string;
  targetTerms: string[];
  targetVocabularyIds: string[];
  paragraphs: string[];
  targetVocabulary?: Vocabulary[];
};

export type StorySummary = Pick<Story, "id" | "level" | "chapter" | "title" | "readingTime">;
