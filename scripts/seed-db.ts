import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seedDatabase, getDatabase, getDatabasePath } from "../lib/database";
import type { Story, Vocabulary } from "../lib/models";

const root = process.cwd();
type VocabularySeedRow = Omit<Vocabulary, "id" | "vocabularyId" | "status"> & { id: string };
type SupplementalVocabularyRow = {
  id?: string;
  term: string;
  level?: Vocabulary["level"];
  importance?: number;
  meaning: string;
  translation?: string;
  example: string;
  exampleTranslation: string;
};
const baseVocabularySource = JSON.parse(readFileSync(resolve(root, "data/vocabulary.json"), "utf8")) as VocabularySeedRow[];
const pronunciations = JSON.parse(readFileSync(resolve(root, "data/pronunciations.json"), "utf8")) as Record<string, string>;
const supplementalVocabularySource = [
  ...JSON.parse(readFileSync(resolve(root, "data/vocabulary-cefr-j.json"), "utf8")) as SupplementalVocabularyRow[],
  ...JSON.parse(readFileSync(resolve(root, "data/vocabulary-stories.json"), "utf8")) as SupplementalVocabularyRow[],
];
const vocabularySource = [
  ...baseVocabularySource,
  ...supplementalVocabularySource.map((item) => ({
    id: item.id ?? `cefr-j-${item.term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    level: item.level ?? "中学",
    importance: item.importance ?? 2,
    term: item.term,
    meaning: item.meaning,
    translation: item.translation ?? item.meaning,
    example: item.example,
    exampleTranslation: item.exampleTranslation,
  })),
];
const vocabulary: Omit<Vocabulary, "id" | "status">[] = vocabularySource.map(({ id, ...item }) => ({
  ...item,
  pronunciation: pronunciations[item.term] ?? "",
  vocabularyId: id,
}));
const stories = JSON.parse(readFileSync(resolve(root, "data/stories.json"), "utf8")) as Story[];

const vocabularyById = new Map(vocabulary.map((item) => [item.vocabularyId, item]));
const vocabularyByTerm = new Map(vocabulary.map((item) => [item.term, item]));
if (vocabularyById.size !== vocabulary.length || vocabularyByTerm.size !== vocabulary.length) {
  throw new Error("Vocabulary IDs and terms must be unique.");
}
for (const item of vocabulary) {
  if (!item.meaning.trim() || !item.example.trim() || !item.exampleTranslation.trim()) {
    throw new Error(`Vocabulary "${item.term}" is missing a meaning or example translation.`);
  }
  if (!item.pronunciation) throw new Error(`Vocabulary "${item.term}" is missing its pronunciation.`);
}
const storyIds = new Set<string>();
for (const story of stories) {
  if (storyIds.has(story.id)) throw new Error(`Duplicate story ID: ${story.id}`);
  storyIds.add(story.id);
  const wordCount = story.paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 100 || wordCount > 200) {
    throw new Error(`Story "${story.id}" must contain 100-200 words; found ${wordCount}.`);
  }
  const referencedVocabulary = story.targetVocabularyIds.map((id) => vocabularyById.get(id));
  if (!story.targetVocabularyIds.length || referencedVocabulary.some((item) => !item)) {
    throw new Error(`Story "${story.id}" contains an unknown or empty targetVocabularyIds list.`);
  }
  const termsFromIds = referencedVocabulary.map((item) => item!.term);
  if (story.targetTerms.length !== termsFromIds.length || story.targetTerms.some((term, index) => term !== termsFromIds[index])) {
    throw new Error(`Story "${story.id}" targetTerms must match targetVocabularyIds in the same order.`);
  }
  const text = story.paragraphs.join(" ");
  for (const term of termsFromIds) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      throw new Error(`Story "${story.id}" does not contain its target term "${term}".`);
    }
    if (!vocabularyByTerm.has(term)) {
      throw new Error(`Story "${story.id}" references an unknown term "${term}".`);
    }
  }
}
seedDatabase(vocabulary, stories);
console.log(`Seeded ${vocabulary.length} vocabulary entries and ${stories.length} stories into ${getDatabasePath()}`);
getDatabase().close();
