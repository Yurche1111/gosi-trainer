import type {
  AppSettings,
  AppState,
  ExamLogEntry,
  Flashcard,
  ProgressMap,
  QuizQuestion,
  Ticket,
  TicketProgress,
  TicketStatus,
} from "../types";
import { emptyCardState, isDue, isMature } from "./srs";

export const PASS_RATIO = 0.8;
export const QUIZ_SAMPLE_SIZE = 8;
export const KEEP_ATTEMPTS = 10;
export const KEEP_EXAMS = 5;

export const DEFAULT_SETTINGS: AppSettings = {
  examDate: undefined,
  newCardsPerDay: 12,
  reviewsPerDay: 60,
};

export function emptyTicketProgress(): TicketProgress {
  return {
    read: false,
    cards: {},
    attempts: [],
    practiceDone: {},
    checksPassed: {},
    updatedAt: "",
  };
}

export function emptyAppState(): AppState {
  return {
    progress: {},
    exams: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Готовность билета 0..1. Учитываются: прочитано, доля выученных карт, лучший тест, практика. */
export function getReadiness(ticket: Ticket, p?: TicketProgress): number {
  const totalCards = ticket.flashcards.length;
  const matureCards = totalCards
    ? ticket.flashcards.filter((c) => isMature(p?.cards[c.id])).length
    : 0;
  const totalQuestions = ticket.quiz.length;
  const bestRatio = bestQuizRatio(p);
  const practiceTotal = ticket.practice?.length ?? 0;
  const practiceDone = practiceTotal
    ? ticket.practice!.filter((task) => p?.practiceDone[task.id]).length
    : 0;

  const readPart = p?.read ? 0.1 : 0; // 10% веса
  const cardsPart = totalCards ? 0.35 * (matureCards / totalCards) : 0.35;
  const quizPart =
    totalQuestions === 0 ? 0.4 : 0.4 * Math.min(1, bestRatio / PASS_RATIO);
  const practicePart =
    practiceTotal === 0 ? 0.15 : 0.15 * (practiceDone / practiceTotal);

  return Math.max(0, Math.min(1, readPart + cardsPart + quizPart + practicePart));
}

export function bestQuizRatio(p?: TicketProgress): number {
  if (!p || p.attempts.length === 0) return 0;
  return p.attempts.reduce((max, a) => Math.max(max, a.ratio), 0);
}

export function lastQuizRatio(p?: TicketProgress): number {
  if (!p || p.attempts.length === 0) return 0;
  return p.attempts[p.attempts.length - 1].ratio;
}

export function getTicketStatus(ticket: Ticket, p?: TicketProgress, now = new Date()): TicketStatus {
  const totalCards = ticket.flashcards.length;
  const seenCards = totalCards
    ? ticket.flashcards.filter((c) => (p?.cards[c.id]?.reps ?? 0) > 0).length
    : 0;
  const matureCards = totalCards
    ? ticket.flashcards.filter((c) => isMature(p?.cards[c.id])).length
    : 0;
  const dueCards = totalCards
    ? ticket.flashcards.filter((c) => {
        const state = p?.cards[c.id];
        return (state?.reps ?? 0) > 0 && isDue(state, now);
      }).length
    : 0;

  const totalQuestions = ticket.quiz.length;
  const bestRatio = bestQuizRatio(p);
  const lastRatio = lastQuizRatio(p);
  const attempts = p?.attempts.length ?? 0;
  const practiceTotal = ticket.practice?.length ?? 0;
  const practiceDone = practiceTotal
    ? ticket.practice!.filter((t) => p?.practiceDone[t.id]).length
    : 0;
  const read = Boolean(p?.read);

  const readiness = getReadiness(ticket, p);

  const cardsReady = totalCards === 0 || matureCards / totalCards >= 0.7;
  const quizReady = totalQuestions === 0 || bestRatio >= PASS_RATIO;
  const practiceReady = practiceTotal === 0 || practiceDone === practiceTotal;
  const mastered = read && cardsReady && quizReady && practiceReady;
  const weak = attempts > 0 && bestRatio < PASS_RATIO;

  let label: TicketStatus["label"] = "не начат";
  if (mastered) label = "готово";
  else if (weak) label = "слабая тема";
  else if (read || attempts > 0 || seenCards > 0 || practiceDone > 0) label = "в работе";

  return {
    read,
    matureCards,
    seenCards,
    totalCards,
    dueCards,
    bestRatio,
    lastRatio,
    attempts,
    practiceDone,
    practiceTotal,
    readiness,
    mastered,
    weak,
    label,
  };
}

export interface SectionStats {
  total: number;
  mastered: number;
  weak: number;
  inProgress: number;
}

export function getSectionStats(tickets: Ticket[], progress: ProgressMap): SectionStats {
  const statuses = tickets.map((t) => getTicketStatus(t, progress[t.id]));
  return {
    total: statuses.length,
    mastered: statuses.filter((s) => s.mastered).length,
    weak: statuses.filter((s) => s.weak).length,
    inProgress: statuses.filter((s) => s.label === "в работе").length,
  };
}

export function getTotalStats(tickets: Ticket[], progress: ProgressMap) {
  const statuses = tickets.map((t) => getTicketStatus(t, progress[t.id]));
  const attempted = statuses.filter((s) => s.attempts > 0);
  const ratioSum = attempted.reduce((sum, s) => sum + s.bestRatio, 0);
  return {
    total: statuses.length,
    mastered: statuses.filter((s) => s.mastered).length,
    weak: statuses.filter((s) => s.weak).length,
    inProgress: statuses.filter((s) => s.label === "в работе").length,
    scorePercent: attempted.length ? Math.round((ratioSum / attempted.length) * 100) : 0,
    attempted: attempted.length,
    avgReadiness:
      statuses.length > 0
        ? Math.round((statuses.reduce((sum, s) => sum + s.readiness, 0) / statuses.length) * 100)
        : 0,
  };
}

export function findNextTicket(tickets: Ticket[], progress: ProgressMap): Ticket {
  const weak = tickets.find((t) => getTicketStatus(t, progress[t.id]).weak);
  if (weak) return weak;
  const inProgress = tickets.find((t) => {
    const s = getTicketStatus(t, progress[t.id]);
    return s.label === "в работе" && !s.mastered;
  });
  if (inProgress) return inProgress;
  const fresh = tickets.find((t) => !getTicketStatus(t, progress[t.id]).mastered);
  return fresh ?? tickets[0];
}

export function getWeakTickets(tickets: Ticket[], progress: ProgressMap): Ticket[] {
  return tickets.filter((t) => getTicketStatus(t, progress[t.id]).weak);
}

export function pickRandomTickets(tickets: Ticket[], count: number, seed = Date.now()): Ticket[] {
  const pool = tickets.slice();
  const result: Ticket[] = [];
  let s = seed;
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const index = Math.floor((s / 233280) * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

export function pickExamTickets(
  ticketsBySection: Record<number, Ticket[]>,
  sectionIds: number[][],
  seed = Date.now(),
): Ticket[] {
  let s = seed;
  return sectionIds.map((groupIds) => {
    const pool = groupIds.flatMap((id) => ticketsBySection[id] ?? []);
    s = (s * 9301 + 49297) % 233280;
    const index = Math.floor((s / 233280) * pool.length);
    return pool[index];
  });
}

/** Случайная подвыборка вопросов теста. Если questions ≤ size — возвращает все. */
export function sampleQuiz(quiz: QuizQuestion[], size = QUIZ_SAMPLE_SIZE, seed = Date.now()): QuizQuestion[] {
  if (quiz.length <= size) return quiz.slice();
  const pool = quiz.slice();
  const out: QuizQuestion[] = [];
  let s = seed;
  for (let i = 0; i < size && pool.length > 0; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const idx = Math.floor((s / 233280) * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Все карты со всех билетов, которые пора показать (due). */
export function collectDueCards(
  tickets: Ticket[],
  progress: ProgressMap,
  now = new Date(),
): { card: Flashcard; ticket: Ticket }[] {
  const out: { card: Flashcard; ticket: Ticket }[] = [];
  for (const ticket of tickets) {
    const ticketProgress = progress[ticket.id];
    for (const card of ticket.flashcards) {
      const state = ticketProgress?.cards[card.id];
      if ((state?.reps ?? 0) > 0 && isDue(state, now)) {
        out.push({ card, ticket });
      }
    }
  }
  return out;
}

/** Карты, которые ещё ни разу не показывались. */
export function collectNewCards(
  tickets: Ticket[],
  progress: ProgressMap,
): { card: Flashcard; ticket: Ticket }[] {
  const out: { card: Flashcard; ticket: Ticket }[] = [];
  for (const ticket of tickets) {
    const ticketProgress = progress[ticket.id];
    for (const card of ticket.flashcards) {
      const state = ticketProgress?.cards[card.id];
      if ((state?.reps ?? 0) === 0) {
        out.push({ card, ticket });
      }
    }
  }
  return out;
}

export interface DailyPlan {
  /** Сколько повторов карт сегодня. */
  reviewCount: number;
  /** Сколько новых карт можно сегодня. */
  newCount: number;
  /** Билеты, которые рекомендуется проработать сегодня (3 ближайших по очереди). */
  ticketSuggestions: Ticket[];
  /** Слабых тем в работе. */
  weakCount: number;
  /** До госа дней (если задано). */
  daysUntilExam: number | null;
}

export function getDailyPlan(
  tickets: Ticket[],
  progress: ProgressMap,
  settings: AppSettings,
  now = new Date(),
): DailyPlan {
  const due = collectDueCards(tickets, progress, now);
  const newCards = collectNewCards(tickets, progress);
  const reviewCount = Math.min(due.length, settings.reviewsPerDay);
  const newCount = Math.min(newCards.length, settings.newCardsPerDay);

  const weak = getWeakTickets(tickets, progress);
  const next = findNextTicket(tickets, progress);
  const suggestions: Ticket[] = [];
  if (weak.length > 0) suggestions.push(weak[0]);
  if (!suggestions.find((t) => t.id === next.id)) suggestions.push(next);
  for (const t of tickets) {
    if (suggestions.length >= 3) break;
    const status = getTicketStatus(t, progress[t.id]);
    if (status.label === "в работе" && !suggestions.find((s) => s.id === t.id)) {
      suggestions.push(t);
    }
  }
  for (const t of tickets) {
    if (suggestions.length >= 3) break;
    const status = getTicketStatus(t, progress[t.id]);
    if (status.label === "не начат" && !suggestions.find((s) => s.id === t.id)) {
      suggestions.push(t);
    }
  }

  let daysUntilExam: number | null = null;
  if (settings.examDate) {
    const target = new Date(settings.examDate).getTime();
    daysUntilExam = Math.max(0, Math.ceil((target - now.getTime()) / (24 * 60 * 60 * 1000)));
  }

  return {
    reviewCount,
    newCount,
    ticketSuggestions: suggestions,
    weakCount: weak.length,
    daysUntilExam,
  };
}

/** Записать новую попытку теста, обрезав до KEEP_ATTEMPTS последних. */
export function recordAttempt(progress: TicketProgress, attempt: TicketProgress["attempts"][number]): TicketProgress {
  const attempts = [...progress.attempts, attempt].slice(-KEEP_ATTEMPTS);
  return {
    ...progress,
    attempts,
    updatedAt: new Date().toISOString(),
    read: true,
  };
}

/** Записать результат экзамена. */
export function recordExam(exams: ExamLogEntry[], entry: ExamLogEntry): ExamLogEntry[] {
  return [...exams, entry].slice(-KEEP_EXAMS);
}
