export type SectionKind = "theory" | "case";

export interface SectionMeta {
  id: number;
  number: string;
  shortTitle: string;
  title: string;
  kind: SectionKind;
  intro: string;
  bigPicture: string[];
}

export type TheoryBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; text: string; lang?: string }
  | { kind: "formula"; text: string; comment?: string }
  | { kind: "quote"; text: string }
  | { kind: "callout"; tone: "info" | "warn" | "tip"; title: string; text: string }
  | { kind: "check"; question: string; options: string[]; answerIndex: number; explanation: string; id: string };

export interface GlossaryItem {
  term: string;
  meaning: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export type QuizDifficulty = "base" | "hard";

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  /** Сложность: base — обычный, hard — каверзный (case, исключение, сравнение). */
  difficulty?: QuizDifficulty;
  /** Подсказка, к каким секциям теории отсылает (для работы над ошибками). */
  topic?: string;
}

export interface PracticeTask {
  id: string;
  title: string;
  problem: string;
  hint?: string;
  solution: string[];
  answer: string;
}

export interface ExamAnswerPlan {
  opening: string;
  steps: string[];
  closing: string;
  example: string;
}

export interface Ticket {
  id: string;
  number: string;
  sectionId: number;
  title: string;
  oneLiner: string;
  difficulty: 1 | 2 | 3;
  theory: TheoryBlock[];
  glossary: GlossaryItem[];
  examPlan: ExamAnswerPlan;
  pitfalls: string[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  practice?: PracticeTask[];
  relatedTicketIds?: string[];
  /** Памятки — короткие правила/формулы, которые надо запомнить намертво. */
  cheatSheet?: string[];
  /** Что чаще всего комиссия спрашивает уточнять. */
  examinerProvocations?: string[];
}

export type CardGrade = "again" | "hard" | "good" | "easy";

export interface CardSrsState {
  /** Интервал в днях до следующего показа. 0 = новая. */
  intervalDays: number;
  /** Множитель сложности (ease). По умолчанию 2.5. */
  ease: number;
  /** ISO-дата последнего ответа. */
  lastReviewedAt: string;
  /** ISO-дата следующего показа. */
  dueAt: string;
  /** Сколько раз карту видели. */
  reps: number;
  /** Подряд правильных оценок (good/easy). */
  streak: number;
  /** Сколько раз провалили (again). */
  lapses: number;
}

export interface QuizAttempt {
  /** ISO-дата попытки. */
  at: string;
  /** Доля правильных в этой попытке (0..1). */
  ratio: number;
  /** Сколько верно из попытки. */
  correct: number;
  /** Размер выборки в этой попытке (может быть меньше всего банка). */
  total: number;
  /** Какие id оказались неправильными. */
  wrongIds: string[];
}

export interface TicketProgress {
  /** Прочитал ли теорию (галка пользователя). */
  read: boolean;
  /** SRS-состояния карт по id. */
  cards: Record<string, CardSrsState>;
  /** История попыток теста (последние N). */
  attempts: QuizAttempt[];
  /** Состояние практических задач. */
  practiceDone: Record<string, boolean>;
  /** Микро-квизы внутри теории: id блока → правильный ответ дан хотя бы раз. */
  checksPassed: Record<string, boolean>;
  /** ISO-дата обновления. */
  updatedAt: string;
}

export type ProgressMap = Record<string, TicketProgress>;

export interface TicketStatus {
  read: boolean;
  /** Сколько карт уже выучено (интервал ≥ 4 дней). */
  matureCards: number;
  /** Сколько карт хотя бы раз показано. */
  seenCards: number;
  totalCards: number;
  /** Сколько карт просрочено к показу прямо сейчас. */
  dueCards: number;
  /** Лучший показатель теста (доля). */
  bestRatio: number;
  /** Доля последней попытки. */
  lastRatio: number;
  attempts: number;
  practiceDone: number;
  practiceTotal: number;
  /** Готовность билета: 0..1. */
  readiness: number;
  mastered: boolean;
  weak: boolean;
  label: "не начат" | "в работе" | "слабая тема" | "готово";
}

export interface ExamLogEntry {
  at: string;
  ticketIds: string[];
  /** Балл по каждому билету (доля). */
  ticketRatios: number[];
  /** Общий балл (среднее). */
  overallRatio: number;
}

export interface AppSettings {
  /** ISO-дата госа. */
  examDate?: string;
  /** Сколько новых карт в день показывать. */
  newCardsPerDay: number;
  /** Сколько повторов в день. */
  reviewsPerDay: number;
}

export interface StreakState {
  /** Текущая серия дней подряд. */
  current: number;
  /** Лучшая серия дней. */
  best: number;
  /** ISO-дата последней активности (yyyy-mm-dd). */
  lastActiveDate: string;
}

export interface MistakeRecord {
  /** id вопроса. */
  questionId: string;
  /** id билета. */
  ticketId: string;
  /** Кол-во раз, когда юзер ошибся в этом вопросе. */
  count: number;
  /** Когда последний раз ошибся. */
  lastAt: string;
}

export interface AppState {
  progress: ProgressMap;
  exams: ExamLogEntry[];
  settings: AppSettings;
  streak: StreakState;
  /** Карта ошибок: ключ = questionId. */
  mistakes: Record<string, MistakeRecord>;
}
