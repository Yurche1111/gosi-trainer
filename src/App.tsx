import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Dices,
  Flame,
  GraduationCap,
  History,
  Home as HomeIcon,
  Layers3,
  Lightbulb,
  Link2,
  ListChecks,
  PartyPopper,
  PlayCircle,
  Repeat2,
  Search,
  Settings as SettingsIcon,
  Target,
  Timer,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  allTickets,
  getSection,
  getSectionTickets,
  getTicket,
  sections,
  ticketsBySection,
} from "./data/studyModel";
import {
  buildDrill,
  bumpStreak,
  clearMistake,
  collectDueCards,
  collectNewCards,
  emptyAppState,
  emptyTicketProgress,
  findNextTicket,
  getDailyPlan,
  getReadiness,
  getSectionStats,
  getTicketStatus,
  getTotalStats,
  getWeakTickets,
  groupTheoryIntoSections,
  logMistakes,
  nextStep,
  nextTicket,
  pickCardSession,
  pickExamTickets,
  pickRandomTickets,
  recordAttempt,
  recordExam,
  sampleQuiz,
  sampleQuizMixed,
  streakIsAlive,
  topMistakes,
} from "./lib/studyEngine";
import type { DrillItem, StudyStep } from "./lib/studyEngine";
import { describeInterval, schedule } from "./lib/srs";
import type {
  AppState,
  CardGrade,
  ExamLogEntry,
  Flashcard,
  PracticeTask,
  QuizQuestion,
  TheoryBlock,
  Ticket,
  TicketProgress,
} from "./types";

const STORAGE_KEY = "gosi-study-state-v4";

type Screen =
  | { kind: "home" }
  | { kind: "section"; sectionId: number }
  | { kind: "ticket"; ticketId: string; mode: TicketMode | null }
  | { kind: "review" }
  | { kind: "exam"; ticketIds: string[]; current: number; results: number[] }
  | { kind: "exam-result"; entry: ExamLogEntry }
  | { kind: "settings" };

type TicketMode = "theory" | "cards" | "quiz" | "practice" | "plan" | "drill" | "done";

interface SearchHit {
  ticket: Ticket;
  reason: string;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [state, setState] = useState<AppState>(() => loadState());
  const [examAnswers, setExamAnswers] = useState<Record<string, number>>({});
  const [examQuizSample, setExamQuizSample] = useState<QuizQuestion[]>([]);

  const persist = (next: AppState, options?: { bumpStreak?: boolean }) => {
    let toSave = next;
    if (options?.bumpStreak !== false) {
      toSave = { ...next, streak: bumpStreak(next.streak) };
    }
    setState(toSave);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // ignore
    }
  };

  function updateProgress(ticketId: string, change: Partial<TicketProgress>) {
    const previous = state.progress[ticketId] ?? emptyTicketProgress();
    persist({
      ...state,
      progress: {
        ...state.progress,
        [ticketId]: {
          ...previous,
          ...change,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }

  function rateCard(ticketId: string, card: Flashcard, grade: CardGrade) {
    const previous = state.progress[ticketId] ?? emptyTicketProgress();
    const now = new Date();
    const { state: cardState } = schedule(previous.cards[card.id], grade, now);
    persist({
      ...state,
      progress: {
        ...state.progress,
        [ticketId]: {
          ...previous,
          cards: { ...previous.cards, [card.id]: cardState },
          updatedAt: now.toISOString(),
        },
      },
    });
  }

  function markCheckPassed(ticketId: string, blockId: string, correct: boolean) {
    const previous = state.progress[ticketId] ?? emptyTicketProgress();
    if (correct) {
      updateProgress(ticketId, {
        checksPassed: { ...previous.checksPassed, [blockId]: true },
      });
    }
  }

  function saveQuizAttempt(ticketId: string, sample: QuizQuestion[], answers: Record<string, number>) {
    const correct = sample.filter((q) => answers[q.id] === q.answerIndex).length;
    const wrong = sample.filter((q) => answers[q.id] !== q.answerIndex).map((q) => q.id);
    const correctIds = sample.filter((q) => answers[q.id] === q.answerIndex).map((q) => q.id);
    const ratio = sample.length ? correct / sample.length : 0;
    const previous = state.progress[ticketId] ?? emptyTicketProgress();
    const updated = recordAttempt(previous, {
      at: new Date().toISOString(),
      ratio,
      correct,
      total: sample.length,
      wrongIds: wrong,
    });
    let nextMistakes = logMistakes(state.mistakes, wrong, ticketId);
    // Если правильно ответил на вопрос, в котором раньше ошибался — снимаем его из «работы над ошибками».
    for (const id of correctIds) nextMistakes = clearMistake(nextMistakes, id);
    persist({
      ...state,
      progress: { ...state.progress, [ticketId]: updated },
      mistakes: nextMistakes,
    });
  }

  function completePractice(ticketId: string, taskId: string, done: boolean) {
    const previous = state.progress[ticketId] ?? emptyTicketProgress();
    updateProgress(ticketId, {
      practiceDone: { ...previous.practiceDone, [taskId]: done },
    });
  }

  function openTicket(ticketId: string, mode: TicketMode | null = null) {
    setScreen({ kind: "ticket", ticketId, mode });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function continueLearning() {
    const next = findNextTicket(allTickets, state.progress);
    const status = getTicketStatus(next, state.progress[next.id]);
    openTicket(next.id, status.read ? "cards" : "theory");
  }

  function repeatWeak() {
    const weak = getWeakTickets(allTickets, state.progress)[0];
    if (weak) openTicket(weak.id, "quiz");
    else continueLearning();
  }

  function openRandomTicket() {
    const [t] = pickRandomTickets(allTickets, 1);
    if (t) openTicket(t.id, null);
  }

  function startExam() {
    const examTickets = pickExamTickets(ticketsBySection, [
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9],
    ]);
    setScreen({
      kind: "exam",
      ticketIds: examTickets.map((t) => t.id),
      current: 0,
      results: [],
    });
    setExamAnswers({});
    const first = examTickets[0];
    if (first) setExamQuizSample(sampleQuizMixed(first.quiz, 8, 0.6));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function nextExamTicket() {
    if (screen.kind !== "exam") return;
    const ticket = getTicket(screen.ticketIds[screen.current]);
    if (!ticket) return;
    const sample = examQuizSample.length ? examQuizSample : ticket.quiz;
    const correct = sample.filter((q) => examAnswers[q.id] === q.answerIndex).length;
    const ratio = sample.length ? correct / sample.length : 0;
    const newResults = [...screen.results, ratio];

    if (screen.current + 1 < screen.ticketIds.length) {
      const nextIdx = screen.current + 1;
      const nextT = getTicket(screen.ticketIds[nextIdx]);
      setScreen({ ...screen, current: nextIdx, results: newResults });
      setExamAnswers({});
      if (nextT) setExamQuizSample(sampleQuizMixed(nextT.quiz, 8, 0.6));
      window.scrollTo({ top: 0, behavior: "auto" });
    } else {
      const entry: ExamLogEntry = {
        at: new Date().toISOString(),
        ticketIds: screen.ticketIds,
        ticketRatios: newResults,
        overallRatio: newResults.reduce((a, b) => a + b, 0) / newResults.length,
      };
      persist({ ...state, exams: recordExam(state.exams, entry) });
      setScreen({ kind: "exam-result", entry });
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function resetAllProgress() {
    if (window.confirm("Сбросить весь прогресс?")) {
      persist(emptyAppState());
    }
  }

  function updateSettings(patch: Partial<AppState["settings"]>) {
    persist({ ...state, settings: { ...state.settings, ...patch } });
  }

  return (
    <div className="app-shell">
      <Header
        screen={screen}
        onHome={() => setScreen({ kind: "home" })}
        onSettings={() => setScreen({ kind: "settings" })}
      />
      {screen.kind === "home" && (
        <HomeScreen
          state={state}
          onContinue={continueLearning}
          onRepeatWeak={repeatWeak}
          onRandom={openRandomTicket}
          onExam={startExam}
          onReview={() => setScreen({ kind: "review" })}
          onOpenSection={(id) => setScreen({ kind: "section", sectionId: id })}
          onOpenTicket={(id) => openTicket(id)}
        />
      )}
      {screen.kind === "section" && (
        <SectionScreen
          sectionId={screen.sectionId}
          state={state}
          onBack={() => setScreen({ kind: "home" })}
          onOpenTicket={(t) => openTicket(t.id)}
        />
      )}
      {screen.kind === "ticket" && (
        <TicketScreen
          key={screen.ticketId + ":" + (screen.mode ?? "menu")}
          ticketId={screen.ticketId}
          mode={screen.mode}
          state={state}
          onModeChange={(mode) => setScreen({ kind: "ticket", ticketId: screen.ticketId, mode })}
          onBackToSection={() => {
            const ticket = getTicket(screen.ticketId);
            setScreen(ticket ? { kind: "section", sectionId: ticket.sectionId } : { kind: "home" });
          }}
          onOpenTicket={(id, mode) => openTicket(id, mode)}
          onMarkRead={(id) => updateProgress(id, { read: true })}
          onRateCard={rateCard}
          onCheckAnswer={markCheckPassed}
          onSaveQuiz={saveQuizAttempt}
          onCompletePractice={completePractice}
          onHome={() => setScreen({ kind: "home" })}
        />
      )}
      {screen.kind === "review" && (
        <ReviewScreen
          state={state}
          onBack={() => setScreen({ kind: "home" })}
          onRateCard={rateCard}
          onOpenTicket={(id) => openTicket(id, "theory")}
        />
      )}
      {screen.kind === "exam" && (
        <ExamScreen
          ticketIds={screen.ticketIds}
          current={screen.current}
          quizSample={examQuizSample}
          answers={examAnswers}
          onChooseAnswer={(q, idx) => setExamAnswers((s) => ({ ...s, [q.id]: idx }))}
          onNext={nextExamTicket}
          onExit={() => setScreen({ kind: "home" })}
        />
      )}
      {screen.kind === "exam-result" && (
        <ExamResultScreen
          entry={screen.entry}
          history={state.exams}
          onHome={() => setScreen({ kind: "home" })}
          onAgain={startExam}
        />
      )}
      {screen.kind === "settings" && (
        <SettingsScreen
          state={state}
          onBack={() => setScreen({ kind: "home" })}
          onUpdate={updateSettings}
          onReset={resetAllProgress}
          onImport={(s) => persist(s)}
        />
      )}
    </div>
  );
}

function Header({
  screen,
  onHome,
  onSettings,
}: {
  screen: Screen;
  onHome: () => void;
  onSettings: () => void;
}) {
  let kicker = "МТИД 2026";
  let title = "Тренажёр госов";
  if (screen.kind === "section") {
    const section = getSection(screen.sectionId);
    kicker = `Раздел ${section.number}`;
    title = section.shortTitle;
  } else if (screen.kind === "ticket") {
    const ticket = getTicket(screen.ticketId);
    if (ticket) {
      kicker = `Билет ${ticket.number}`;
      title = ticket.title;
    }
  } else if (screen.kind === "exam") {
    kicker = "Экзамен";
    title = `Билет ${screen.current + 1} из ${screen.ticketIds.length}`;
  } else if (screen.kind === "exam-result") {
    kicker = "Экзамен";
    title = "Результат";
  } else if (screen.kind === "review") {
    kicker = "Повторение";
    title = "Сегодняшние карты";
  } else if (screen.kind === "settings") {
    kicker = "Настройки";
    title = "Подготовка";
  }
  return (
    <header className="app-header">
      <button type="button" className="icon-button" onClick={onHome} aria-label="На главную">
        <HomeIcon size={20} />
      </button>
      <div className="app-header-title">
        <p>{kicker}</p>
        <h1>{title}</h1>
      </div>
      <button type="button" className="icon-button" onClick={onSettings} aria-label="Настройки">
        <SettingsIcon size={20} />
      </button>
    </header>
  );
}

function HomeScreen({
  state,
  onContinue,
  onRepeatWeak,
  onRandom,
  onExam,
  onReview,
  onOpenSection,
  onOpenTicket,
}: {
  state: AppState;
  onContinue: () => void;
  onRepeatWeak: () => void;
  onRandom: () => void;
  onExam: () => void;
  onReview: () => void;
  onOpenSection: (id: number) => void;
  onOpenTicket: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const totalStats = useMemo(() => getTotalStats(allTickets, state.progress), [state.progress]);
  const dailyPlan = useMemo(
    () => getDailyPlan(allTickets, state.progress, state.settings),
    [state.progress, state.settings],
  );
  const next = useMemo(() => findNextTicket(allTickets, state.progress), [state.progress]);
  const hits = useMemo(() => searchTickets(query), [query]);
  const masteredPercent = totalStats.total
    ? Math.round((totalStats.mastered / totalStats.total) * 100)
    : 0;
  const mistakesTop = useMemo(() => topMistakes(state.mistakes, 5), [state.mistakes]);

  return (
    <main className="home-screen">
      <section className="daily-card">
        <div className="daily-head">
          <p className="eyebrow">Сегодня</p>
          <div className="daily-head-meta">
            {state.streak.current > 0 && (
              <span
                className={`streak-chip ${streakIsAlive(state.streak) ? "alive" : "dead"}`}
                title={`Лучшая серия: ${state.streak.best}`}
              >
                <Flame size={14} />
                {state.streak.current} {state.streak.current === 1 ? "день" : "дней"}
              </span>
            )}
            {dailyPlan.daysUntilExam !== null && (
              <span className="exam-countdown">
                <CalendarDays size={14} />
                {dailyPlan.daysUntilExam === 0
                  ? "сегодня экзамен"
                  : `${dailyPlan.daysUntilExam} дн. до госа`}
              </span>
            )}
          </div>
        </div>
        <div className="daily-stats">
          <DailyStat
            icon={<Repeat2 size={18} />}
            value={dailyPlan.reviewCount}
            label="на повторение"
            tone={dailyPlan.reviewCount > 0 ? "warm" : "muted"}
            onClick={dailyPlan.reviewCount > 0 ? onReview : undefined}
          />
          <DailyStat
            icon={<Flame size={18} />}
            value={dailyPlan.newCount}
            label="новых карт"
            tone={dailyPlan.newCount > 0 ? "info" : "muted"}
          />
          <DailyStat
            icon={<Brain size={18} />}
            value={dailyPlan.weakCount}
            label="слабых тем"
            tone={dailyPlan.weakCount > 0 ? "danger" : "muted"}
          />
        </div>
        <div className="daily-suggestion">
          <p className="eyebrow">Следующий билет</p>
          <h2>
            {next.number}. {next.title}
          </h2>
          <p className="hero-sub">{getSection(next.sectionId).shortTitle}</p>
          <button type="button" className="primary-button big" onClick={onContinue}>
            <Target size={20} />
            Продолжить
          </button>
        </div>
      </section>
      <section className="search-panel">
        <div className="search-input">
          <Search size={20} />
          <input
            type="search"
            placeholder="Поиск: «1.5», «регрессия», «BPMN»..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {query.trim().length > 0 && (
          <div className="search-results">
            {hits.length === 0 ? (
              <p className="muted">Ничего не нашлось.</p>
            ) : (
              hits.slice(0, 10).map((hit) => (
                <button
                  key={hit.ticket.id}
                  type="button"
                  className="search-hit"
                  onClick={() => onOpenTicket(hit.ticket.id)}
                >
                  <span className="ticket-num">{hit.ticket.number}</span>
                  <span>
                    <strong>{hit.ticket.title}</strong>
                    <small>{hit.reason}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </section>
      {mistakesTop.length > 0 && (
        <section className="mistakes-card">
          <div className="mistakes-head">
            <p className="eyebrow">
              <Brain size={14} /> Работа над ошибками
            </p>
            <span className="muted">{Object.keys(state.mistakes).length} вопросов</span>
          </div>
          <p className="muted">Вопросы, в которых ты чаще всего ошибался. Открой билет, чтобы повторить тему.</p>
          <ul className="mistakes-list">
            {mistakesTop.map((m) => {
              const t = getTicket(m.ticketId);
              if (!t) return null;
              return (
                <li key={m.questionId}>
                  <button
                    type="button"
                    className="mistake-item"
                    onClick={() => onOpenTicket(m.ticketId)}
                  >
                    <span className="ticket-num">{t.number}</span>
                    <span className="mistake-text">
                      <strong>{t.title}</strong>
                      <small>ошибок: {m.count}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="action-grid">
        <ActionTile
          icon={<Repeat2 size={22} />}
          label="Повторение"
          sub={dailyPlan.reviewCount > 0 ? `${dailyPlan.reviewCount} карт ждут` : "всё освежено"}
          onClick={onReview}
          accent={dailyPlan.reviewCount > 0}
          disabled={dailyPlan.reviewCount === 0}
        />
        <ActionTile
          icon={<Brain size={22} />}
          label="Слабые темы"
          sub={`${dailyPlan.weakCount} провалено`}
          onClick={onRepeatWeak}
          disabled={dailyPlan.weakCount === 0}
        />
        <ActionTile
          icon={<Dices size={22} />}
          label="Случайный"
          sub="любой из 75"
          onClick={onRandom}
        />
        <ActionTile
          icon={<GraduationCap size={22} />}
          label="Экзамен"
          sub="2 билета"
          onClick={onExam}
        />
      </section>
      <section className="progress-panel">
        <div>
          <p className="eyebrow">Прогресс</p>
          <strong>
            {totalStats.mastered} из {totalStats.total} билетов готовы
          </strong>
        </div>
        <div className="progress-bar">
          <span style={{ width: `${masteredPercent}%` }} />
        </div>
        <div className="progress-stats">
          <span><b>{masteredPercent}%</b><i>готово</i></span>
          <span><b>{totalStats.weak}</b><i>слабые</i></span>
          <span><b>{totalStats.scorePercent}%</b><i>средний тест</i></span>
          <span><b>{totalStats.avgReadiness}%</b><i>в среднем</i></span>
        </div>
      </section>
      <section className="section-stack">
        <p className="eyebrow">Разделы</p>
        {sections.map((section) => {
          const tickets = getSectionTickets(section.id);
          const stats = getSectionStats(tickets, state.progress);
          const percent = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;
          return (
            <button
              key={section.id}
              type="button"
              className="section-card"
              onClick={() => onOpenSection(section.id)}
            >
              <span className="section-number">{section.number}</span>
              <span className="section-body">
                <strong>{section.shortTitle}</strong>
                <small>{tickets.length} билетов · {section.kind === "case" ? "практика" : "теория"}</small>
                <span className="inline-progress"><i style={{ width: `${percent}%` }} /></span>
              </span>
              <span className="section-meta">
                <em>{stats.mastered}/{stats.total}</em>
                <ChevronRight size={18} />
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}

function DailyStat({
  icon,
  value,
  label,
  tone,
  onClick,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  tone: "warm" | "info" | "danger" | "muted";
  onClick?: () => void;
}) {
  const className = `daily-stat tone-${tone}${onClick ? " clickable" : ""}`;
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span className="daily-icon">{icon}</span>
        <strong>{value}</strong>
        <small>{label}</small>
      </button>
    );
  }
  return (
    <div className={className}>
      <span className="daily-icon">{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function ActionTile({
  icon,
  label,
  sub,
  onClick,
  disabled,
  accent,
}: {
  icon: ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      className={`action-tile${accent ? " accent" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="action-icon">{icon}</span>
      <strong>{label}</strong>
      <small>{sub}</small>
    </button>
  );
}

function SectionScreen({
  sectionId,
  state,
  onBack,
  onOpenTicket,
}: {
  sectionId: number;
  state: AppState;
  onBack: () => void;
  onOpenTicket: (t: Ticket) => void;
}) {
  const section = getSection(sectionId);
  const tickets = getSectionTickets(sectionId);
  const stats = getSectionStats(tickets, state.progress);
  const percent = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;

  return (
    <main className="study-screen">
      <button type="button" className="back-button" onClick={onBack}>
        <ArrowLeft size={18} /> Все разделы
      </button>
      <section className="intro-panel">
        <p className="eyebrow">
          Раздел {section.number} · {section.kind === "case" ? "практика" : "теория"}
        </p>
        <h2>{section.title}</h2>
        <p className="core-idea">{section.intro}</p>
        <details className="big-picture">
          <summary>Что важно понять в разделе</summary>
          <div className="explain-list">
            {section.bigPicture.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </details>
        <div className="hero-progress">
          <div className="progress-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span>
            {stats.mastered}/{stats.total} готово
          </span>
        </div>
      </section>
      <section className="route-list">
        {tickets.map((ticket) => {
          const status = getTicketStatus(ticket, state.progress[ticket.id]);
          const readiness = Math.round(getReadiness(ticket, state.progress[ticket.id]) * 100);
          return (
            <button
              key={ticket.id}
              type="button"
              className="route-item"
              onClick={() => onOpenTicket(ticket)}
            >
              <span className="ticket-num">{ticket.number}</span>
              <span className="route-body">
                <strong>{ticket.title}</strong>
                <small>{ticket.oneLiner}</small>
                <span className="inline-progress sm">
                  <i style={{ width: `${readiness}%` }} />
                </span>
              </span>
              <span className="route-meta">
                <TicketBadge status={status.label} />
                <ChevronRight size={18} />
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────
// TicketScreen — главный экран с пошаговым флоу
// ─────────────────────────────────────────────

function TicketScreen({
  ticketId,
  mode,
  state,
  onModeChange,
  onBackToSection,
  onOpenTicket,
  onMarkRead,
  onRateCard,
  onCheckAnswer,
  onSaveQuiz,
  onCompletePractice,
  onHome,
}: {
  ticketId: string;
  mode: TicketMode | null;
  state: AppState;
  onModeChange: (mode: TicketMode | null) => void;
  onBackToSection: () => void;
  onOpenTicket: (id: string, mode: TicketMode | null) => void;
  onMarkRead: (ticketId: string) => void;
  onRateCard: (ticketId: string, card: Flashcard, grade: CardGrade) => void;
  onCheckAnswer: (ticketId: string, blockId: string, correct: boolean) => void;
  onSaveQuiz: (ticketId: string, sample: QuizQuestion[], answers: Record<string, number>) => void;
  onCompletePractice: (ticketId: string, taskId: string, done: boolean) => void;
  onHome: () => void;
}) {
  const ticket = getTicket(ticketId);
  if (!ticket) {
    return (
      <main className="study-screen">
        <p>Билет не найден.</p>
      </main>
    );
  }
  const section = getSection(ticket.sectionId);
  const progress = state.progress[ticket.id];
  const status = getTicketStatus(ticket, progress);
  const hasPractice = (ticket.practice?.length ?? 0) > 0;
  const related = (ticket.relatedTicketIds ?? [])
    .map((id) => getTicket(id))
    .filter(Boolean) as Ticket[];

  // Меню билета
  if (mode === null) {
    return (
      <main className="study-screen">
        <button type="button" className="back-button" onClick={onBackToSection}>
          <ArrowLeft size={18} /> К билетам раздела
        </button>
        <section className="ticket-hero">
          <p className="eyebrow">
            {section.shortTitle} · сложность {"●".repeat(ticket.difficulty)}
            {"○".repeat(3 - ticket.difficulty)}
          </p>
          <h2>{ticket.number}. {ticket.title}</h2>
          <p>{ticket.oneLiner}</p>
          <div className="readiness-bar">
            <div className="progress-bar">
              <span style={{ width: `${Math.round(status.readiness * 100)}%` }} />
            </div>
            <span>{Math.round(status.readiness * 100)}% готовности</span>
          </div>
          <div className="ticket-metrics">
            <span>{status.label}</span>
            <span>тест {Math.round(status.bestRatio * 100)}%</span>
            <span>{status.matureCards}/{status.totalCards} выучено</span>
            {status.dueCards > 0 && <span className="metric-warm">⌚ {status.dueCards} к повтору</span>}
            {hasPractice && <span>задачи {status.practiceDone}/{status.practiceTotal}</span>}
          </div>
        </section>
        <button type="button" className="primary-button big" onClick={() => onModeChange("theory")}>
          <ArrowRight size={20} /> Начать обучение
        </button>
        <section className="mode-grid">
          <ModeTile
            icon={<BookOpen size={26} />}
            title="Теория"
            sub="разбор и определения"
            done={status.read}
            onClick={() => onModeChange("theory")}
          />
          <ModeTile
            icon={<Lightbulb size={26} />}
            title="План ответа"
            sub="шпаргалка для комиссии"
            onClick={() => onModeChange("plan")}
            accent
          />
          <ModeTile
            icon={<Layers3 size={26} />}
            title="Карточки"
            sub={
              status.totalCards === 0
                ? "—"
                : status.dueCards > 0
                  ? `${status.dueCards} к повтору`
                  : `${status.matureCards}/${status.totalCards} выучено`
            }
            done={status.totalCards > 0 && status.matureCards >= Math.ceil(status.totalCards * 0.7)}
            onClick={() => onModeChange("cards")}
            warm={status.dueCards > 0}
          />
          <ModeTile
            icon={<ClipboardCheck size={26} />}
            title="Тест"
            sub={
              status.attempts === 0
                ? `банк ${ticket.quiz.length} вопросов`
                : `лучший ${Math.round(status.bestRatio * 100)}%`
            }
            done={status.bestRatio >= 0.8}
            onClick={() => onModeChange("quiz")}
          />
          {hasPractice && (
            <ModeTile
              icon={<ListChecks size={26} />}
              title="Практика"
              sub={`${status.practiceDone}/${status.practiceTotal} решено`}
              done={status.practiceTotal > 0 && status.practiceDone === status.practiceTotal}
              onClick={() => onModeChange("practice")}
            />
          )}
          <ModeTile
            icon={<PlayCircle size={26} />}
            title="Прогон"
            sub="5-минутная проверка билета"
            onClick={() => onModeChange("drill")}
            full
          />
        </section>
        {related.length > 0 && (
          <section className="related-panel">
            <p className="eyebrow">
              <Link2 size={14} /> Связанные билеты
            </p>
            <div className="related-list">
              {related.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="related-item"
                  onClick={() => onOpenTicket(r.id, null)}
                >
                  <span className="ticket-num">{r.number}</span>
                  <span>{r.title}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    );
  }

  // Переход к следующему шагу или экран «билет освоен»
  function goToNext(currentStep: StudyStep) {
    const next = nextStep(ticket!, currentStep);
    if (next) {
      onModeChange(next as TicketMode);
    } else {
      onModeChange("done");
    }
  }

  return (
    <main className="study-screen">
      <button type="button" className="back-button" onClick={() => onModeChange(null)}>
        <ArrowLeft size={18} /> К билету {ticket.number}
      </button>
      {mode === "theory" && (
        <TheoryFlow
          ticket={ticket}
          progress={progress}
          onMarkRead={() => onMarkRead(ticket.id)}
          onCheckAnswer={(blockId, correct) => onCheckAnswer(ticket.id, blockId, correct)}
          onNext={() => goToNext("theory")}
        />
      )}
      {mode === "plan" && (
        <ExamPlanPanel ticket={ticket} onNext={() => onModeChange("quiz")} />
      )}
      {mode === "cards" && (
        <CardSession
          ticket={ticket}
          progress={progress}
          onRateCard={(card, grade) => onRateCard(ticket.id, card, grade)}
          onNext={() => goToNext("cards")}
          onShowPlan={() => onModeChange("plan")}
        />
      )}
      {mode === "quiz" && (
        <QuizFlow
          ticket={ticket}
          progress={progress}
          onSaveQuiz={(sample, answers) => onSaveQuiz(ticket.id, sample, answers)}
          onNext={() => goToNext("quiz")}
          onBackToTheory={() => onModeChange("theory")}
        />
      )}
      {mode === "practice" && hasPractice && (
        <PracticeFlow
          ticket={ticket}
          progress={progress}
          onComplete={(taskId, done) => onCompletePractice(ticket.id, taskId, done)}
          onNext={() => goToNext("practice")}
        />
      )}
      {mode === "drill" && (
        <DrillFlow
          ticket={ticket}
          progress={progress}
          onRateCard={(card, grade) => onRateCard(ticket.id, card, grade)}
          onCompleteAt={() => undefined}
          onBack={() => onModeChange(null)}
        />
      )}
      {mode === "done" && (
        <TicketDoneScreen
          ticket={ticket}
          onNextTicket={() => {
            const nt = nextTicket(allTickets, ticket.id);
            if (nt) onOpenTicket(nt.id, "theory");
            else onHome();
          }}
          onBackToMenu={() => onModeChange(null)}
          onDrill={() => onModeChange("drill")}
          onHome={onHome}
        />
      )}
    </main>
  );
}

function ModeTile({
  icon,
  title,
  sub,
  onClick,
  done,
  accent,
  full,
  warm,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
  done?: boolean;
  accent?: boolean;
  full?: boolean;
  warm?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mode-tile${done ? " done" : ""}${accent ? " accent" : ""}${full ? " full" : ""}${warm ? " warm" : ""}`}
      onClick={onClick}
    >
      <span className="mode-icon">{icon}</span>
      <span className="mode-text">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
      {done && <CheckCircle2 size={18} className="mode-check" />}
    </button>
  );
}

// ─────────────────────────────────────────────
// Теория: пошаговая по секциям
// ─────────────────────────────────────────────

function TheoryFlow({
  ticket,
  progress,
  onMarkRead,
  onCheckAnswer,
  onNext,
}: {
  ticket: Ticket;
  progress: TicketProgress | undefined;
  onMarkRead: () => void;
  onCheckAnswer: (blockId: string, correct: boolean) => void;
  onNext: () => void;
}) {
  const sectionsList = useMemo(() => groupTheoryIntoSections(ticket.theory), [ticket.theory]);
  const hasCheatSheet = (ticket.cheatSheet?.length ?? 0) > 0;
  const hasProvocations = (ticket.examinerProvocations?.length ?? 0) > 0;
  // Дополнительные шаги: глоссарий+pitfalls, памятка, провокации.
  const extraSteps: Array<"closing" | "cheatSheet" | "provocations"> = ["closing"];
  if (hasCheatSheet) extraSteps.push("cheatSheet");
  if (hasProvocations) extraSteps.push("provocations");
  const totalSteps = sectionsList.length + extraSteps.length;
  const [step, setStep] = useState(0);
  const isLast = step === totalSteps - 1;
  const stepLabel = `${step + 1} / ${totalSteps}`;
  const extraStep = step >= sectionsList.length ? extraSteps[step - sectionsList.length] : null;

  function go(delta: number) {
    setStep((s) => Math.max(0, Math.min(totalSteps - 1, s + delta)));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function handleFinish() {
    onMarkRead();
    onNext();
  }

  return (
    <article className="content-panel">
      <div className="step-progress">
        <div className="step-bar">
          <span style={{ width: `${((step + 1) / totalSteps) * 100}%` }} />
        </div>
        <span className="step-counter">Часть {stepLabel}</span>
      </div>

      {step < sectionsList.length && (
        <>
          <h2 className="step-title">{sectionsList[step].heading}</h2>
          {sectionsList[step].blocks.map((block, idx) => (
            <BlockRenderer
              key={`${ticket.id}-s${step}-${idx}`}
              block={block}
              alreadyPassed={
                block.kind === "check" && progress?.checksPassed[block.id] ? true : false
              }
              onCheckAnswer={onCheckAnswer}
            />
          ))}
        </>
      )}
      {extraStep === "closing" && (
        <>
          <h2 className="step-title">Закрепление</h2>
          {ticket.glossary.length > 0 && (
            <details className="study-block collapsible" open>
              <summary>
                <h3>Глоссарий ({ticket.glossary.length})</h3>
              </summary>
              <dl className="glossary">
                {ticket.glossary.map((g) => (
                  <div key={g.term}>
                    <dt>{g.term}</dt>
                    <dd>{g.meaning}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <details className="study-block collapsible" open>
            <summary>
              <h3>Где обычно проваливают</h3>
            </summary>
            <ul>
              {ticket.pitfalls.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      {extraStep === "cheatSheet" && (
        <>
          <h2 className="step-title">Памятка для гос-экзамена</h2>
          <p className="muted">3-5 правил, которые комиссия любит спрашивать. Запоминаются быстро, спасают часто.</p>
          <ul className="cheatsheet-list">
            {(ticket.cheatSheet ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {extraStep === "provocations" && (
        <>
          <h2 className="step-title">Типичные вопросы комиссии</h2>
          <p className="muted">Когда основной ответ дан, экзаменатор любит уточнить. Будь готов:</p>
          <ol className="provocations-list">
            {(ticket.examinerProvocations ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </>
      )}

      <div className="bottom-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => go(-1)}
          disabled={step === 0}
        >
          <ArrowLeft size={18} /> Назад
        </button>
        {isLast ? (
          <button type="button" className="primary-button" onClick={handleFinish}>
            <ArrowRight size={18} /> Дальше: карточки
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={() => go(1)}>
            Дальше <ArrowRight size={18} />
          </button>
        )}
      </div>
    </article>
  );
}

function Coach({ tone, title, text }: { tone: "info" | "warm" | "tip"; title: string; text: string }) {
  return (
    <aside className={`coach tone-${tone}`}>
      <strong>{title}</strong>
      <p>{text}</p>
    </aside>
  );
}

function ExamPlanPanel({ ticket, onNext }: { ticket: Ticket; onNext: () => void }) {
  return (
    <article className="content-panel">
      <section className="study-block">
        <h3>Вступление</h3>
        <p>{ticket.examPlan.opening}</p>
      </section>
      <section className="study-block">
        <h3>План ответа</h3>
        <ol>
          {ticket.examPlan.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section className="study-block">
        <h3>Пример</h3>
        <p>{ticket.examPlan.example}</p>
      </section>
      <section className="study-block">
        <h3>Финал</h3>
        <p>{ticket.examPlan.closing}</p>
      </section>
      <button type="button" className="primary-button big" onClick={onNext}>
        <ArrowRight size={20} /> Дальше: тест
      </button>
    </article>
  );
}

// ─────────────────────────────────────────────
// Сессия карт
// ─────────────────────────────────────────────

function CardSession({
  ticket,
  progress,
  onRateCard,
  onNext,
  onShowPlan,
}: {
  ticket: Ticket;
  progress: TicketProgress | undefined;
  onRateCard: (card: Flashcard, grade: CardGrade) => void;
  onNext: () => void;
  onShowPlan: () => void;
}) {
  const session = useMemo(() => pickCardSession(ticket, progress), [ticket, progress]);
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [stats, setStats] = useState<{ again: number; hard: number; good: number; easy: number }>({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });

  if (session.length === 0) {
    return (
      <article className="content-panel">
        <div className="empty-state">
          <Layers3 size={28} />
          <h2>Карточек нет</h2>
          <p>В этом билете не нашлось карт для тренировки.</p>
          <button type="button" className="primary-button" onClick={onNext}>
            Дальше: тест <ArrowRight size={18} />
          </button>
        </div>
      </article>
    );
  }

  if (idx >= session.length) {
    const total = stats.again + stats.hard + stats.good + stats.easy;
    return (
      <article className="content-panel">
        <div className="finish-card">
          <PartyPopper size={32} />
          <h2>Сессия пройдена</h2>
          <p>Прошли {total} карточек.</p>
          <div className="finish-grid">
            <span className="tone-easy">Легко: <b>{stats.easy}</b></span>
            <span className="tone-good">Хорошо: <b>{stats.good}</b></span>
            <span className="tone-hard">Тяжело: <b>{stats.hard}</b></span>
            <span className="tone-again">Снова: <b>{stats.again}</b></span>
          </div>
        </div>

        <section className="plan-preview">
          <p className="eyebrow">
            <Lightbulb size={14} /> А теперь представь, что ты у комиссии
          </p>
          <p className="plan-preview-opening">{ticket.examPlan.opening}</p>
          <ol className="plan-preview-steps">
            {ticket.examPlan.steps.slice(0, 3).map((step) => (
              <li key={step}>{step}</li>
            ))}
            {ticket.examPlan.steps.length > 3 && (
              <li className="muted">…ещё {ticket.examPlan.steps.length - 3} пункта</li>
            )}
          </ol>
          <button type="button" className="secondary-button big" onClick={onShowPlan}>
            <Lightbulb size={18} /> Полный план ответа
          </button>
        </section>

        <button type="button" className="primary-button big" onClick={onNext}>
          Дальше: тест <ArrowRight size={20} />
        </button>
      </article>
    );
  }

  const current = session[idx];
  const cardState = progress?.cards[current.id];

  function rate(grade: CardGrade) {
    onRateCard(current, grade);
    setStats((s) => ({ ...s, [grade]: s[grade] + 1 }));
    setShowBack(false);
    setIdx((i) => i + 1);
  }

  return (
    <article className="content-panel">
      <div className="step-progress">
        <div className="step-bar">
          <span style={{ width: `${((idx + 1) / session.length) * 100}%` }} />
        </div>
        <span className="step-counter">Карта {idx + 1} / {session.length}</span>
      </div>
      {idx === 0 && (
        <Coach
          tone="info"
          title="Закрепляем определения"
          text="Сейчас ты пройдёшь сессию из карт. Отвечай честно: «Снова» если не помнишь, «Хорошо» если вспомнил быстро. Чем точнее оценка — тем умнее интервалы повтора."
        />
      )}
      <button
        type="button"
        className={`memory-card ${showBack ? "flipped" : ""}`}
        onClick={() => setShowBack((s) => !s)}
      >
        <span>{showBack ? "ответ" : "вопрос"}</span>
        <h3>{showBack ? current.back : current.front}</h3>
        <small className="tap-hint">{showBack ? "тап — скрыть" : "тап — показать ответ"}</small>
      </button>
      <div className="srs-actions">
        <SrsButton tone="again" label="Снова" hint="<10 мин" onClick={() => rate("again")} />
        <SrsButton tone="hard" label="Тяжело" hint={describeInterval(scheduleHint(cardState, "hard"))} onClick={() => rate("hard")} />
        <SrsButton tone="good" label="Хорошо" hint={describeInterval(scheduleHint(cardState, "good"))} onClick={() => rate("good")} />
        <SrsButton tone="easy" label="Легко" hint={describeInterval(scheduleHint(cardState, "easy"))} onClick={() => rate("easy")} />
      </div>
    </article>
  );
}

function scheduleHint(state: NonNullable<TicketProgress["cards"][string]> | undefined, grade: CardGrade): number {
  return schedule(state, grade).intervalDays;
}

function SrsButton({
  tone,
  label,
  hint,
  onClick,
}: {
  tone: "again" | "hard" | "good" | "easy";
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`srs-button tone-${tone}`} onClick={onClick}>
      <strong>{label}</strong>
      <small>{hint}</small>
    </button>
  );
}

// ─────────────────────────────────────────────
// Тест: по одному вопросу + финальный экран
// ─────────────────────────────────────────────

function QuizFlow({
  ticket,
  progress,
  onSaveQuiz,
  onNext,
  onBackToTheory,
}: {
  ticket: Ticket;
  progress: TicketProgress | undefined;
  onSaveQuiz: (sample: QuizQuestion[], answers: Record<string, number>) => void;
  onNext: () => void;
  onBackToTheory: () => void;
}) {
  const sample = useMemo(() => sampleQuizMixed(ticket.quiz, 8, 0.4), [ticket.quiz]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const total = sample.length;
  const finished = idx >= total;
  const correctCount = sample.filter((q) => answers[q.id] === q.answerIndex).length;
  const ratio = total ? correctCount / total : 0;
  const passed = ratio >= 0.8;

  function pickOption(i: number) {
    if (picked !== null) return;
    setPicked(i);
    setAnswers((a) => ({ ...a, [sample[idx].id]: i }));
  }

  function nextQ() {
    setPicked(null);
    setIdx((i) => i + 1);
  }

  function handleSave() {
    onSaveQuiz(sample, answers);
    setSaved(true);
  }

  if (finished) {
    const wrongList = sample.filter((q) => answers[q.id] !== q.answerIndex);
    return (
      <article className="content-panel">
        <div className={`finish-card ${passed ? "passed" : "failed"}`}>
          {passed ? <PartyPopper size={32} /> : <Brain size={32} />}
          <h2>{correctCount} из {total}</h2>
          <p>{passed ? "Тема засчитана. Хорошая работа." : "Меньше 80% — нужно повторить."}</p>
          <p className="muted">{Math.round(ratio * 100)}% правильных</p>
        </div>

        {!passed && wrongList.length > 0 && saved && (
          <section className="study-block">
            <h3>На что обратить внимание</h3>
            <ul>
              {wrongList.slice(0, 5).map((q) => (
                <li key={q.id}>
                  <strong>{q.prompt}</strong>
                  <br />
                  <span className="muted">{q.explanation}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!saved && (
          <button type="button" className="primary-button big" onClick={handleSave}>
            <CheckCircle2 size={20} /> Сохранить результат
          </button>
        )}
        {saved && passed && (
          <button type="button" className="primary-button big" onClick={onNext}>
            {ticket.practice && ticket.practice.length > 0 ? "Дальше: практика" : "Завершить билет"}{" "}
            <ArrowRight size={20} />
          </button>
        )}
        {saved && !passed && (
          <>
            <button type="button" className="primary-button big" onClick={onBackToTheory}>
              <BookOpen size={20} /> Перечитать теорию
            </button>
            <button
              type="button"
              className="secondary-button big"
              onClick={() => {
                setIdx(0);
                setAnswers({});
                setPicked(null);
                setSaved(false);
              }}
            >
              <Repeat2 size={20} /> Пройти тест заново
            </button>
            <button type="button" className="secondary-button big" onClick={onNext}>
              Пропустить и идти дальше <ArrowRight size={20} />
            </button>
          </>
        )}
      </article>
    );
  }

  const q = sample[idx];
  const answered = picked !== null;
  const isCorrect = picked === q.answerIndex;

  return (
    <article className="content-panel">
      <div className="step-progress">
        <div className="step-bar">
          <span style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
        <span className="step-counter">Вопрос {idx + 1} / {total}</span>
      </div>
      {idx === 0 && (
        <Coach
          tone="warm"
          title="Готов? Тест без подсказок."
          text="8 случайных вопросов из банка. 60% базовых + 40% сложных (кейсы, сравнения). Не подсматривай — лучше ошибиться и понять."
        />
      )}
      <section className="quiz-item single">
        <h3>{q.prompt}</h3>
        <div className="options-list">
          {q.options.map((option, i) => (
            <button
              key={`${q.id}-${i}`}
              type="button"
              className={getOptionClass(answered, isCorrect, picked ?? undefined, q.answerIndex, i)}
              onClick={() => pickOption(i)}
              disabled={answered}
            >
              {option}
            </button>
          ))}
        </div>
        {answered && (
          <p className={isCorrect ? "explanation correct" : "explanation wrong"}>
            {isCorrect ? "Верно. " : "Ошибка. "}
            {q.explanation}
          </p>
        )}
      </section>
      <div className="bottom-actions single">
        <button
          type="button"
          className="primary-button"
          onClick={nextQ}
          disabled={!answered}
        >
          {idx + 1 < total ? "Следующий вопрос" : "Завершить тест"} <ArrowRight size={18} />
        </button>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────
// Практика: по одной задаче
// ─────────────────────────────────────────────

function PracticeFlow({
  ticket,
  progress,
  onComplete,
  onNext,
}: {
  ticket: Ticket;
  progress: TicketProgress | undefined;
  onComplete: (taskId: string, done: boolean) => void;
  onNext: () => void;
}) {
  const tasks = ticket.practice ?? [];
  const [idx, setIdx] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  if (idx >= tasks.length) {
    return (
      <article className="content-panel">
        <div className="finish-card passed">
          <PartyPopper size={32} />
          <h2>Все задачи разобраны</h2>
          <p>Закрепил материал на расчётных примерах.</p>
        </div>
        <button type="button" className="primary-button big" onClick={onNext}>
          Завершить билет <ArrowRight size={20} />
        </button>
      </article>
    );
  }

  const task = tasks[idx];
  const done = Boolean(progress?.practiceDone[task.id]);

  return (
    <article className="content-panel">
      <div className="step-progress">
        <div className="step-bar">
          <span style={{ width: `${((idx + 1) / tasks.length) * 100}%` }} />
        </div>
        <span className="step-counter">Задача {idx + 1} / {tasks.length}</span>
      </div>
      {idx === 0 && (
        <Coach
          tone="tip"
          title="Самое важное — задачи"
          text="Решай сначала сам, без подглядывания. Если совсем застрял — открой подсказку. Решение смотри только после своей попытки."
        />
      )}
      <section className="practice-card">
        <div className="practice-head">
          <h3>{task.title}</h3>
          {done && <span className="done-badge">решено</span>}
        </div>
        <p className="practice-problem">{task.problem}</p>
        {task.hint && (
          <p className="practice-hint">
            <strong>Подсказка.</strong> {task.hint}
          </p>
        )}
        {!showSolution && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowSolution(true)}
          >
            Показать решение
          </button>
        )}
        {showSolution && (
          <div className="practice-solution">
            <h4>Решение</h4>
            <ol>
              {task.solution.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="practice-answer">
              <strong>Ответ.</strong> {task.answer}
            </p>
          </div>
        )}
      </section>
      <div className="bottom-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            onComplete(task.id, !done);
          }}
        >
          {done ? "Снять отметку" : "Я разобрал"}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setShowSolution(false);
            setIdx((i) => i + 1);
          }}
        >
          {idx + 1 < tasks.length ? "Следующая задача" : "Завершить"} <ArrowRight size={18} />
        </button>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────
// Прогон: 3 карты + 3 вопроса + 1 практика
// ─────────────────────────────────────────────

function DrillFlow({
  ticket,
  progress,
  onRateCard,
  onBack,
}: {
  ticket: Ticket;
  progress: TicketProgress | undefined;
  onRateCard: (card: Flashcard, grade: CardGrade) => void;
  onCompleteAt: (taskId: string, done: boolean) => void;
  onBack: () => void;
}) {
  const items = useMemo<DrillItem[]>(() => buildDrill(ticket, progress), [ticket, progress]);
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [showSolution, setShowSolution] = useState(false);

  if (items.length === 0) {
    return (
      <article className="content-panel">
        <div className="empty-state">
          <PlayCircle size={28} />
          <h2>Прогон недоступен</h2>
          <p>Нет данных для быстрой проверки.</p>
          <button type="button" className="primary-button" onClick={onBack}>
            Назад
          </button>
        </div>
      </article>
    );
  }

  if (idx >= items.length) {
    return (
      <article className="content-panel">
        <div className="finish-card passed">
          <PartyPopper size={32} />
          <h2>Прогон завершён</h2>
          <p>Закрепил билет за 5 минут.</p>
        </div>
        <button type="button" className="primary-button big" onClick={onBack}>
          В меню билета <ArrowRight size={20} />
        </button>
      </article>
    );
  }

  const item = items[idx];

  function nextItem() {
    setShowBack(false);
    setPicked(null);
    setShowSolution(false);
    setIdx((i) => i + 1);
  }

  return (
    <article className="content-panel">
      <div className="step-progress">
        <div className="step-bar">
          <span style={{ width: `${((idx + 1) / items.length) * 100}%` }} />
        </div>
        <span className="step-counter">
          {idx + 1} / {items.length} ·{" "}
          {item.kind === "card" ? "карта" : item.kind === "quiz" ? "вопрос" : "задача"}
        </span>
      </div>
      {item.kind === "card" && item.card && (
        <>
          <button
            type="button"
            className={`memory-card ${showBack ? "flipped" : ""}`}
            onClick={() => setShowBack((s) => !s)}
          >
            <span>{showBack ? "ответ" : "вопрос"}</span>
            <h3>{showBack ? item.card.back : item.card.front}</h3>
            <small className="tap-hint">{showBack ? "тап — скрыть" : "тап — показать ответ"}</small>
          </button>
          <div className="srs-actions">
            <SrsButton tone="again" label="Снова" hint="" onClick={() => { onRateCard(item.card!, "again"); nextItem(); }} />
            <SrsButton tone="hard" label="Тяжело" hint="" onClick={() => { onRateCard(item.card!, "hard"); nextItem(); }} />
            <SrsButton tone="good" label="Хорошо" hint="" onClick={() => { onRateCard(item.card!, "good"); nextItem(); }} />
            <SrsButton tone="easy" label="Легко" hint="" onClick={() => { onRateCard(item.card!, "easy"); nextItem(); }} />
          </div>
        </>
      )}
      {item.kind === "quiz" && item.question && (
        <>
          <section className="quiz-item single">
            <h3>{item.question.prompt}</h3>
            <div className="options-list">
              {item.question.options.map((option, i) => (
                <button
                  key={`${item.question!.id}-${i}`}
                  type="button"
                  className={getOptionClass(picked !== null, picked === item.question!.answerIndex, picked ?? undefined, item.question!.answerIndex, i)}
                  onClick={() => picked === null && setPicked(i)}
                  disabled={picked !== null}
                >
                  {option}
                </button>
              ))}
            </div>
            {picked !== null && (
              <p className={picked === item.question.answerIndex ? "explanation correct" : "explanation wrong"}>
                {picked === item.question.answerIndex ? "Верно. " : "Ошибка. "}
                {item.question.explanation}
              </p>
            )}
          </section>
          <div className="bottom-actions single">
            <button type="button" className="primary-button" onClick={nextItem} disabled={picked === null}>
              Дальше <ArrowRight size={18} />
            </button>
          </div>
        </>
      )}
      {item.kind === "practice" && item.task && (
        <>
          <section className="practice-card">
            <h3>{item.task.title}</h3>
            <p className="practice-problem">{item.task.problem}</p>
            {item.task.hint && (
              <p className="practice-hint">
                <strong>Подсказка.</strong> {item.task.hint}
              </p>
            )}
            {!showSolution && (
              <button type="button" className="secondary-button" onClick={() => setShowSolution(true)}>
                Показать решение
              </button>
            )}
            {showSolution && (
              <div className="practice-solution">
                <h4>Решение</h4>
                <ol>
                  {item.task.solution.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="practice-answer">
                  <strong>Ответ.</strong> {item.task.answer}
                </p>
              </div>
            )}
          </section>
          <div className="bottom-actions single">
            <button type="button" className="primary-button" onClick={nextItem}>
              Завершить <ArrowRight size={18} />
            </button>
          </div>
        </>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────
// «Билет освоен»
// ─────────────────────────────────────────────

function TicketDoneScreen({
  ticket,
  onNextTicket,
  onBackToMenu,
  onDrill,
  onHome,
}: {
  ticket: Ticket;
  onNextTicket: () => void;
  onBackToMenu: () => void;
  onDrill: () => void;
  onHome: () => void;
}) {
  const nt = nextTicket(allTickets, ticket.id);
  return (
    <article className="content-panel">
      <div className="finish-card passed big-finish">
        <PartyPopper size={42} />
        <h2>Билет освоен</h2>
        <p>{ticket.number}. {ticket.title}</p>
        <p className="muted">Теория, карточки и тест пройдены.</p>
      </div>

      <section className="drill-cta">
        <div className="drill-cta-text">
          <p className="eyebrow">
            <PlayCircle size={14} /> Хочешь закрепить?
          </p>
          <p>
            Сделай <b>прогон</b> — 5 минут: 3 случайные карты, 3 вопроса теста и одна задача.
            Это лучший способ убедиться, что билет реально засел.
          </p>
        </div>
        <button type="button" className="secondary-button big" onClick={onDrill}>
          <PlayCircle size={18} /> Сделать прогон
        </button>
      </section>

      {nt ? (
        <button type="button" className="primary-button big" onClick={onNextTicket}>
          Следующий билет: {nt.number}. {nt.title} <ArrowRight size={20} />
        </button>
      ) : (
        <button type="button" className="primary-button big" onClick={onHome}>
          На главную <ArrowRight size={20} />
        </button>
      )}
      <button type="button" className="secondary-button big" onClick={onBackToMenu}>
        В меню билета
      </button>
    </article>
  );
}

// ─────────────────────────────────────────────
// Повторение, Экзамен, Настройки (без изменений)
// ─────────────────────────────────────────────

function ReviewScreen({
  state,
  onBack,
  onRateCard,
  onOpenTicket,
}: {
  state: AppState;
  onBack: () => void;
  onRateCard: (ticketId: string, card: Flashcard, grade: CardGrade) => void;
  onOpenTicket: (id: string) => void;
}) {
  const queue = useMemo(() => {
    const due = collectDueCards(allTickets, state.progress);
    if (due.length >= state.settings.reviewsPerDay) {
      return due.slice(0, state.settings.reviewsPerDay);
    }
    const remaining = state.settings.newCardsPerDay;
    const fresh = collectNewCards(allTickets, state.progress).slice(0, remaining);
    return [...due, ...fresh];
  }, [state.progress, state.settings]);

  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const total = queue.length;
  const current = queue[idx];

  if (total === 0) {
    return (
      <main className="study-screen">
        <button type="button" className="back-button" onClick={onBack}>
          <ArrowLeft size={18} /> На главную
        </button>
        <section className="empty-state">
          <Repeat2 size={32} />
          <h2>Карты не ждут</h2>
          <p>Все интервалы свежие. Можно учить новые билеты или отдохнуть.</p>
          <button type="button" className="primary-button" onClick={onBack}>
            Хорошо
          </button>
        </section>
      </main>
    );
  }

  if (idx >= total) {
    return (
      <main className="study-screen">
        <button type="button" className="back-button" onClick={onBack}>
          <ArrowLeft size={18} /> На главную
        </button>
        <section className="empty-state">
          <CheckCircle2 size={32} />
          <h2>Готово на сегодня</h2>
          <p>Ты прошёл {total} карточек. Возвращайся завтра — система покажет новые повторы.</p>
          <button type="button" className="primary-button" onClick={onBack}>
            На главную
          </button>
        </section>
      </main>
    );
  }

  const cardState = state.progress[current.ticket.id]?.cards[current.card.id];
  const isNew = !cardState || cardState.reps === 0;

  return (
    <main className="study-screen">
      <button type="button" className="back-button" onClick={onBack}>
        <ArrowLeft size={18} /> На главную
      </button>
      <section className="review-progress">
        <span>Карта {idx + 1} из {total}</span>
        <div className="progress-bar">
          <span style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
      </section>
      <button
        type="button"
        className="review-source"
        onClick={() => onOpenTicket(current.ticket.id)}
      >
        <span className="ticket-num">{current.ticket.number}</span>
        <span>{current.ticket.title}</span>
      </button>
      <button
        type="button"
        className={`memory-card ${showBack ? "flipped" : ""}`}
        onClick={() => setShowBack((s) => !s)}
      >
        <span>{isNew ? "новая · вопрос" : showBack ? "ответ" : "вопрос"}</span>
        <h3>{showBack ? current.card.back : current.card.front}</h3>
        <small className="tap-hint">{showBack ? "тап — скрыть" : "тап — показать ответ"}</small>
      </button>
      <div className="srs-actions">
        <SrsButton
          tone="again"
          label="Снова"
          hint="<10 мин"
          onClick={() => {
            onRateCard(current.ticket.id, current.card, "again");
            setShowBack(false);
            setIdx((i) => i + 1);
          }}
        />
        <SrsButton
          tone="hard"
          label="Тяжело"
          hint={describeInterval(scheduleHint(cardState, "hard"))}
          onClick={() => {
            onRateCard(current.ticket.id, current.card, "hard");
            setShowBack(false);
            setIdx((i) => i + 1);
          }}
        />
        <SrsButton
          tone="good"
          label="Хорошо"
          hint={describeInterval(scheduleHint(cardState, "good"))}
          onClick={() => {
            onRateCard(current.ticket.id, current.card, "good");
            setShowBack(false);
            setIdx((i) => i + 1);
          }}
        />
        <SrsButton
          tone="easy"
          label="Легко"
          hint={describeInterval(scheduleHint(cardState, "easy"))}
          onClick={() => {
            onRateCard(current.ticket.id, current.card, "easy");
            setShowBack(false);
            setIdx((i) => i + 1);
          }}
        />
      </div>
    </main>
  );
}

function ExamScreen({
  ticketIds,
  current,
  quizSample,
  answers,
  onChooseAnswer,
  onNext,
  onExit,
}: {
  ticketIds: string[];
  current: number;
  quizSample: QuizQuestion[];
  answers: Record<string, number>;
  onChooseAnswer: (q: QuizQuestion, idx: number) => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const ticket = getTicket(ticketIds[current]);
  const [seconds, setSeconds] = useState(15 * 60);
  useEffect(() => {
    const interval = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [current]);
  if (!ticket) return <main className="study-screen"><p>Билет не найден.</p></main>;
  const minutes = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const sample = quizSample.length ? quizSample : ticket.quiz;
  const answered = sample.filter((q) => answers[q.id] !== undefined).length;
  const complete = answered === sample.length;
  return (
    <main className="study-screen">
      <section className="exam-banner">
        <Timer size={18} />
        <strong>{ticket.number}. {ticket.title}</strong>
        <span>{minutes.toString().padStart(2, "0")}:{ss.toString().padStart(2, "0")}</span>
      </section>
      <section className="ticket-hero">
        <p className="eyebrow">{getSection(ticket.sectionId).shortTitle}</p>
        <h2>{ticket.number}. {ticket.title}</h2>
        <p>{ticket.oneLiner}</p>
        <p className="muted">Тест без подсказок. {sample.length} вопросов из банка.</p>
      </section>
      <article className="content-panel">
        <div className="quiz-list">
          {sample.map((question, i) => (
            <section key={question.id} className="quiz-item">
              <h3><span className="q-num">{i + 1}</span>{question.prompt}</h3>
              <div className="options-list">
                {question.options.map((option, optIdx) => (
                  <button
                    key={`${question.id}-${optIdx}`}
                    type="button"
                    className={answers[question.id] === optIdx ? "selected" : ""}
                    onClick={() => onChooseAnswer(question, optIdx)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>
      <div className="bottom-actions">
        <button type="button" className="secondary-button" onClick={onExit}>Выйти</button>
        <button
          type="button"
          className="primary-button"
          disabled={!complete && seconds > 0}
          onClick={onNext}
        >
          {current + 1 < ticketIds.length ? "Следующий билет" : "Завершить"}
        </button>
      </div>
    </main>
  );
}

function ExamResultScreen({
  entry,
  history,
  onHome,
  onAgain,
}: {
  entry: ExamLogEntry;
  history: ExamLogEntry[];
  onHome: () => void;
  onAgain: () => void;
}) {
  const overallPercent = Math.round(entry.overallRatio * 100);
  const passed = overallPercent >= 70;
  return (
    <main className="study-screen">
      <section className={`exam-result ${passed ? "passed" : "failed"}`}>
        <p className="eyebrow">Результат экзамена</p>
        <h2>{overallPercent}%</h2>
        <p>{passed ? "Это сильный результат — на госе так держать." : "Слабовато: повторите билеты и попробуйте ещё раз."}</p>
        <div className="exam-tickets">
          {entry.ticketIds.map((id, idx) => {
            const ticket = getTicket(id);
            return (
              <div key={id} className="exam-ticket">
                <span className="ticket-num">{ticket?.number ?? id}</span>
                <span>{ticket?.title}</span>
                <em>{Math.round((entry.ticketRatios[idx] ?? 0) * 100)}%</em>
              </div>
            );
          })}
        </div>
      </section>
      {history.length > 1 && (
        <section className="content-panel">
          <h3>
            <History size={18} /> История
          </h3>
          <ExamSparkline history={history} />
          <ul className="exam-history">
            {history.slice().reverse().slice(0, 5).map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span>{new Date(h.at).toLocaleString("ru")}</span>
                <strong>{Math.round(h.overallRatio * 100)}%</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="bottom-actions">
        <button type="button" className="secondary-button" onClick={onHome}>На главную</button>
        <button type="button" className="primary-button" onClick={onAgain}>Ещё раз</button>
      </div>
    </main>
  );
}

function ExamSparkline({ history }: { history: ExamLogEntry[] }) {
  const data = history.slice().sort((a, b) => a.at.localeCompare(b.at));
  if (data.length < 2) return null;
  const w = 280;
  const h = 60;
  const pad = 6;
  const dx = (w - pad * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = pad + i * dx;
    const y = pad + (1 - d.overallRatio) * (h - pad * 2);
    return `${x},${y}`;
  });
  const last = data[data.length - 1];
  const lastPercent = Math.round(last.overallRatio * 100);
  return (
    <div className="sparkline">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sl-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2457d6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2457d6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          fill="url(#sl-fill)"
          points={`${pad},${h - pad} ${points.join(" ")} ${w - pad},${h - pad}`}
        />
        <polyline
          fill="none"
          stroke="#2457d6"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.join(" ")}
        />
        {data.map((d, i) => {
          const [x, y] = points[i].split(",");
          const isLast = i === data.length - 1;
          return (
            <circle
              key={d.at + i}
              cx={x}
              cy={y}
              r={isLast ? 4 : 2.5}
              fill={isLast ? "#2457d6" : "#fff"}
              stroke="#2457d6"
              strokeWidth="2"
            />
          );
        })}
      </svg>
      <div className="sparkline-meta">
        <span>{data.length} попыток</span>
        <strong>{lastPercent}%</strong>
      </div>
    </div>
  );
}

function SettingsScreen({
  state,
  onBack,
  onUpdate,
  onReset,
  onImport,
}: {
  state: AppState;
  onBack: () => void;
  onUpdate: (patch: Partial<AppState["settings"]>) => void;
  onReset: () => void;
  onImport: (state: AppState) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  return (
    <main className="study-screen">
      <button type="button" className="back-button" onClick={onBack}>
        <ArrowLeft size={18} /> На главную
      </button>
      <section className="content-panel">
        <h3>Дата экзамена</h3>
        <p className="muted">Если задать дату госа, на главной появится обратный отсчёт.</p>
        <div className="settings-row">
          <input
            type="date"
            value={state.settings.examDate ?? ""}
            min={today}
            onChange={(e) => onUpdate({ examDate: e.target.value || undefined })}
          />
          {state.settings.examDate && (
            <button type="button" className="secondary-button" onClick={() => onUpdate({ examDate: undefined })}>
              Очистить
            </button>
          )}
        </div>
      </section>
      <section className="content-panel">
        <h3>Норма повторений</h3>
        <p className="muted">Сколько карт показывать в день.</p>
        <div className="settings-row">
          <label>
            Новых:
            <input
              type="number"
              min={0}
              max={50}
              value={state.settings.newCardsPerDay}
              onChange={(e) => onUpdate({ newCardsPerDay: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            Повторов:
            <input
              type="number"
              min={0}
              max={300}
              value={state.settings.reviewsPerDay}
              onChange={(e) => onUpdate({ reviewsPerDay: Number(e.target.value) || 0 })}
            />
          </label>
        </div>
      </section>
      <section className="content-panel">
        <h3>Перенос прогресса</h3>
        <p className="muted">
          Сохрани прогресс в файл — потом можно открыть на другом устройстве и импортировать.
        </p>
        <div className="settings-row">
          <button type="button" className="secondary-button" onClick={() => exportState(state)}>
            Экспорт в файл
          </button>
          <label className="secondary-button file-button">
            Импорт из файла
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  if (!parsed || typeof parsed !== "object") throw new Error("bad json");
                  if (!confirm("Заменить текущий прогресс импортированным?")) return;
                  onImport({
                    progress: parsed.progress ?? {},
                    exams: parsed.exams ?? [],
                    settings: { ...emptyAppState().settings, ...(parsed.settings ?? {}) },
                    streak: parsed.streak ?? emptyAppState().streak,
                    mistakes: parsed.mistakes ?? {},
                  });
                  alert("Прогресс импортирован.");
                } catch (err) {
                  alert("Не удалось прочитать файл: " + (err as Error).message);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>
      <section className="content-panel">
        <h3>Сброс</h3>
        <p className="muted">Удалить весь прогресс, лог экзаменов и настройки.</p>
        <button type="button" className="danger-button" onClick={onReset}>Сбросить всё</button>
      </section>
    </main>
  );
}

function exportState(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  a.href = url;
  a.download = `gosi-progress-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// Помощники
// ─────────────────────────────────────────────

function BlockRenderer({
  block,
  alreadyPassed,
  onCheckAnswer,
}: {
  block: TheoryBlock;
  alreadyPassed: boolean;
  onCheckAnswer: (blockId: string, correct: boolean) => void;
}) {
  switch (block.kind) {
    case "p":
      return <p className="theory-p">{block.text}</p>;
    case "h":
      return <h3 className="theory-h">{block.text}</h3>;
    case "ul":
      return (
        <ul className="theory-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="theory-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "code":
      return (
        <pre className="theory-code">
          <code>{block.text}</code>
        </pre>
      );
    case "formula":
      return (
        <div className="theory-formula">
          <pre>{block.text}</pre>
          {block.comment && <small>{block.comment}</small>}
        </div>
      );
    case "quote":
      return <blockquote className="theory-quote">{block.text}</blockquote>;
    case "callout":
      return (
        <aside className={`theory-callout tone-${block.tone}`}>
          <strong>{block.title}</strong>
          <p>{block.text}</p>
        </aside>
      );
    case "check":
      return (
        <MicroCheck
          block={block}
          alreadyPassed={alreadyPassed}
          onAnswered={(correct) => onCheckAnswer(block.id, correct)}
        />
      );
    default:
      return null;
  }
}

function MicroCheck({
  block,
  alreadyPassed,
  onAnswered,
}: {
  block: Extract<TheoryBlock, { kind: "check" }>;
  alreadyPassed: boolean;
  onAnswered: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const isCorrect = picked === block.answerIndex;
  const answered = picked !== null;

  function pick(idx: number) {
    if (picked !== null) return;
    setPicked(idx);
    onAnswered(idx === block.answerIndex);
  }

  return (
    <aside className={`micro-check ${alreadyPassed ? "passed" : ""}`}>
      <div className="micro-check-head">
        <strong>Проверь себя</strong>
        {alreadyPassed && <CheckCircle2 size={16} className="muted-icon" />}
      </div>
      <p>{block.question}</p>
      <div className="options-list">
        {block.options.map((option, idx) => {
          let cls = "";
          if (answered) {
            if (idx === block.answerIndex) cls = "right";
            else if (idx === picked) cls = "wrong";
            else cls = "muted";
          }
          return (
            <button
              key={idx}
              type="button"
              className={cls}
              onClick={() => pick(idx)}
              disabled={answered}
            >
              {option}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className={isCorrect ? "explanation correct" : "explanation wrong"}>
          {isCorrect ? "Верно. " : "Ошибка. "}
          {block.explanation}
        </p>
      )}
    </aside>
  );
}

function TicketBadge({ status }: { status: string }) {
  const cls =
    status === "готово"
      ? "ready"
      : status === "слабая тема"
        ? "weak"
        : status === "в работе"
          ? "progress"
          : "";
  return <em className={`lesson-badge ${cls}`}>{status}</em>;
}

function getOptionClass(
  answered: boolean,
  correct: boolean,
  selected: number | undefined,
  answerIndex: number,
  index: number,
) {
  if (!answered) return "";
  if (index === answerIndex) return "right";
  if (!correct && index === selected) return "wrong";
  return "muted";
}

function searchTickets(query: string): SearchHit[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  return allTickets
    .map((ticket) => {
      const haystack = [
        ticket.number,
        ticket.title,
        ticket.oneLiner,
        ...ticket.glossary.map((g) => `${g.term} ${g.meaning}`),
      ]
        .join(" \n ")
        .toLowerCase();
      const score = haystack.includes(trimmed) ? 1 : 0;
      return { ticket, reason: score ? extractMatch(ticket, trimmed) : "" };
    })
    .filter((hit) => hit.reason)
    .sort((a, b) => a.ticket.number.localeCompare(b.ticket.number, "ru"));
}

function extractMatch(ticket: Ticket, query: string): string {
  if (ticket.number.toLowerCase().includes(query)) return `Билет ${ticket.number}`;
  if (ticket.title.toLowerCase().includes(query)) return ticket.title;
  if (ticket.oneLiner.toLowerCase().includes(query)) return ticket.oneLiner;
  const term = ticket.glossary.find((g) =>
    `${g.term} ${g.meaning}`.toLowerCase().includes(query),
  );
  if (term) return `${term.term}: ${term.meaning}`;
  return ticket.title;
}

function loadState(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAppState();
    const parsed = JSON.parse(raw);
    return {
      progress: parsed.progress ?? {},
      exams: parsed.exams ?? [],
      settings: { ...emptyAppState().settings, ...(parsed.settings ?? {}) },
      streak: parsed.streak ?? emptyAppState().streak,
      mistakes: parsed.mistakes ?? {},
    };
  } catch {
    return emptyAppState();
  }
}
