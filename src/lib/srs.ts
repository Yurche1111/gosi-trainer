import type { CardGrade, CardSrsState } from "../types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;

export function emptyCardState(now = new Date()): CardSrsState {
  return {
    intervalDays: 0,
    ease: DEFAULT_EASE,
    lastReviewedAt: "",
    dueAt: now.toISOString(),
    reps: 0,
    streak: 0,
    lapses: 0,
  };
}

interface ScheduleResult {
  state: CardSrsState;
  intervalDays: number;
}

/** Применяет оценку к карте. Возвращает новое состояние и фактический интервал. */
export function schedule(state: CardSrsState | undefined, grade: CardGrade, now = new Date()): ScheduleResult {
  const prev = state ?? emptyCardState(now);
  let { intervalDays, ease, reps, streak, lapses } = prev;

  // ease-фактор: «снова» -0.20, «тяжело» -0.15, «хорошо» 0, «легко» +0.15.
  const easeDelta =
    grade === "again" ? -0.2 : grade === "hard" ? -0.15 : grade === "easy" ? 0.15 : 0;
  ease = Math.max(MIN_EASE, ease + easeDelta);

  if (grade === "again") {
    intervalDays = 0; // показать сегодня же
    streak = 0;
    lapses += 1;
  } else if (reps === 0) {
    intervalDays = grade === "easy" ? 4 : grade === "hard" ? 1 : 1;
    streak = 1;
  } else if (reps === 1) {
    intervalDays = grade === "easy" ? 6 : grade === "hard" ? 2 : 3;
    streak += 1;
  } else {
    const factor = grade === "easy" ? 1.3 * ease : grade === "hard" ? 1.2 : ease;
    const base = Math.max(1, intervalDays);
    intervalDays = Math.round(base * factor);
    streak += 1;
  }

  reps += 1;

  // Ограничение разумной длины интервала (год).
  intervalDays = Math.min(intervalDays, 365);

  const dueAt = new Date(now.getTime() + intervalDays * DAY_MS);

  return {
    state: {
      intervalDays,
      ease,
      reps,
      streak,
      lapses,
      lastReviewedAt: now.toISOString(),
      dueAt: dueAt.toISOString(),
    },
    intervalDays,
  };
}

/** Просрочена ли карта на данный момент. */
export function isDue(state: CardSrsState | undefined, now = new Date()): boolean {
  if (!state) return true;
  return new Date(state.dueAt).getTime() <= now.getTime();
}

/** Сколько часов до следующего показа (отрицательное — уже просрочено). */
export function hoursUntilDue(state: CardSrsState | undefined, now = new Date()): number {
  if (!state) return 0;
  return (new Date(state.dueAt).getTime() - now.getTime()) / (60 * 60 * 1000);
}

/** Считается ли карта «выученной» (зрелой). */
export function isMature(state: CardSrsState | undefined): boolean {
  if (!state) return false;
  return state.intervalDays >= 21 && state.streak >= 3;
}

export function describeInterval(days: number): string {
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days < 7) return `через ${days} дн.`;
  if (days < 30) return `через ${Math.round(days / 7)} нед.`;
  if (days < 365) return `через ${Math.round(days / 30)} мес.`;
  return "через год+";
}
