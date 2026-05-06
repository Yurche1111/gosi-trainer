import { describe, expect, it } from "vitest";
import { allTickets, ticketsBySection } from "../data/studyModel";
import {
  emptyTicketProgress,
  findNextTicket,
  getDailyPlan,
  getReadiness,
  getSectionStats,
  getTicketStatus,
  getTotalStats,
  getWeakTickets,
  recordAttempt,
  sampleQuiz,
  DEFAULT_SETTINGS,
} from "./studyEngine";
import { schedule } from "./srs";
import type { ProgressMap, TicketProgress } from "../types";

describe("study engine", () => {
  it("each ticket has flashcards, quiz and exam plan", () => {
    for (const ticket of allTickets) {
      expect(ticket.flashcards.length).toBeGreaterThanOrEqual(3);
      expect(ticket.quiz.length).toBeGreaterThanOrEqual(4);
      expect(ticket.examPlan.steps.length).toBeGreaterThanOrEqual(3);
      expect(ticket.theory.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("readiness = 0 for fresh ticket and high after full progress", () => {
    const ticket = allTickets[0];
    expect(getReadiness(ticket, undefined)).toBeLessThan(0.4);

    const cards: TicketProgress["cards"] = {};
    for (const c of ticket.flashcards) {
      // Прогоним достаточное число «good», чтобы перейти в mature (≥21 день, streak ≥3).
      let state = schedule(undefined, "good").state;
      let cursor = new Date();
      for (let i = 0; i < 6; i += 1) {
        cursor = new Date(cursor.getTime() + state.intervalDays * 24 * 60 * 60 * 1000);
        state = schedule(state, "good", cursor).state;
      }
      cards[c.id] = state;
    }

    const progress: TicketProgress = {
      ...emptyTicketProgress(),
      read: true,
      cards,
      attempts: [
        { at: new Date().toISOString(), ratio: 1, correct: ticket.quiz.length, total: ticket.quiz.length, wrongIds: [] },
      ],
      practiceDone: Object.fromEntries((ticket.practice ?? []).map((p) => [p.id, true])),
    };

    expect(getReadiness(ticket, progress)).toBeGreaterThan(0.9);
    expect(getTicketStatus(ticket, progress).mastered).toBe(true);
  });

  it("prioritises weak tickets before untouched", () => {
    const ticket = allTickets[0];
    const progress: ProgressMap = {
      [ticket.id]: {
        ...emptyTicketProgress(),
        read: true,
        attempts: [
          {
            at: new Date().toISOString(),
            ratio: 0.2,
            correct: 1,
            total: ticket.quiz.length,
            wrongIds: ticket.quiz.slice(1).map((q) => q.id),
          },
        ],
      },
    };

    const weak = getWeakTickets(allTickets, progress).map((t) => t.id);
    expect(weak).toContain(ticket.id);
    expect(findNextTicket(allTickets, progress).id).toBe(ticket.id);
    expect(getTotalStats(allTickets, progress).weak).toBe(1);
  });

  it("section stats reflect mastered count", () => {
    const stats = getSectionStats(ticketsBySection[1], {});
    expect(stats.total).toBe(ticketsBySection[1].length);
    expect(stats.mastered).toBe(0);
  });

  it("recordAttempt keeps last 10 entries", () => {
    let p = emptyTicketProgress();
    for (let i = 0; i < 15; i += 1) {
      p = recordAttempt(p, {
        at: new Date().toISOString(),
        ratio: i / 15,
        correct: i,
        total: 15,
        wrongIds: [],
      });
    }
    expect(p.attempts).toHaveLength(10);
  });

  it("sampleQuiz returns at most N questions and never duplicates", () => {
    const quiz = allTickets[0].quiz;
    const sampled = sampleQuiz(quiz, 4, 42);
    expect(sampled.length).toBeLessThanOrEqual(4);
    const ids = new Set(sampled.map((q) => q.id));
    expect(ids.size).toBe(sampled.length);
  });

  it("daily plan suggests something even on empty progress", () => {
    const plan = getDailyPlan(allTickets, {}, DEFAULT_SETTINGS);
    expect(plan.ticketSuggestions.length).toBeGreaterThan(0);
    expect(plan.newCount).toBeGreaterThan(0); // карты ещё новые
    expect(plan.reviewCount).toBe(0);
  });

  it("ticket links are bidirectional or at least exist for both directions where defined", () => {
    // sanity: ссылки указывают на существующие билеты
    for (const ticket of allTickets) {
      for (const id of ticket.relatedTicketIds ?? []) {
        const target = allTickets.find((t) => t.id === id);
        expect(target).toBeDefined();
      }
    }
  });
});

describe("srs", () => {
  it("again resets streak and sets due to today", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    const r = schedule(undefined, "again", now);
    expect(r.state.streak).toBe(0);
    expect(r.state.lapses).toBe(1);
    expect(r.intervalDays).toBe(0);
  });

  it("good progressively grows interval", () => {
    let now = new Date("2026-01-01T10:00:00.000Z");
    let r = schedule(undefined, "good", now);
    const i1 = r.intervalDays;
    now = new Date(now.getTime() + i1 * 86400000);
    r = schedule(r.state, "good", now);
    const i2 = r.intervalDays;
    now = new Date(now.getTime() + i2 * 86400000);
    r = schedule(r.state, "good", now);
    const i3 = r.intervalDays;
    expect(i2).toBeGreaterThanOrEqual(i1);
    expect(i3).toBeGreaterThan(i2);
  });
});
