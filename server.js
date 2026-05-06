import crypto from "node:crypto";
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const sessions = new Map();
const studentProgress = new Map();
const ttlMs = 1000 * 60 * 60 * 6;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("dist"));

app.post("/api/check-sessions", (req, res) => {
  const lesson = req.body?.lesson;
  if (!lesson?.sectionTitle || !lesson?.lessonTitle) {
    return res.status(400).json({ error: "lesson.sectionTitle and lesson.lessonTitle are required" });
  }

  const sessionId = crypto.randomUUID().slice(0, 8).toUpperCase();
  sessions.set(sessionId, {
    id: sessionId,
    lesson,
    review: null,
    createdAt: Date.now(),
  });
  cleanupSessions();

  return res.json({ sessionId, expiresInMinutes: Math.round(ttlMs / 60000) });
});

app.get("/api/check-sessions/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found or expired" });
  }

  return res.json({
    sessionId: session.id,
    lesson: session.lesson,
    hasReview: Boolean(session.review),
  });
});

app.get("/api/check-sessions/:sessionId/review", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found or expired" });
  }

  return res.json({ sessionId: session.id, review: session.review });
});

app.post("/api/check-sessions/:sessionId/review", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found or expired" });
  }

  const review = req.body?.review;
  if (!review || typeof review.score !== "number" || !review.verdict) {
    return res.status(400).json({ error: "review.score and review.verdict are required" });
  }

  session.review = {
    score: clampScore(review.score),
    verdict: String(review.verdict),
    good: normalizeStringArray(review.good),
    missing: normalizeStringArray(review.missing),
    wrong: normalizeStringArray(review.wrong),
    termsToLearn: normalizeStringArray(review.termsToLearn),
    betterAnswer: String(review.betterAnswer ?? ""),
    nextTask: String(review.nextTask ?? ""),
    createdAt: new Date().toISOString(),
  };

  return res.json({ ok: true, sessionId: session.id, review: session.review });
});

app.post("/api/gpt/next-lesson", (req, res) => {
  const studentCode = normalizeStudentCode(req.body?.studentCode);
  const curriculum = normalizeCurriculum(req.body?.curriculum);
  const progress = getStudentProgress(studentCode);
  const allLessons = curriculum.flatMap((section) =>
    section.lessons.map((lesson) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      lesson,
    })),
  );

  const weakLesson = allLessons.find((item) => {
    const saved = progress.lessons[item.lesson.id];
    return saved && saved.aiScore <= 2;
  });
  const newLesson = allLessons.find((item) => !progress.lessons[item.lesson.id]);
  const selected = weakLesson ?? newLesson ?? allLessons[0];

  return res.json({
    studentCode,
    mode: weakLesson ? "repeat_weak" : newLesson ? "new_lesson" : "review_any",
    lesson: selected,
    progressSummary: summarizeProgress(progress),
  });
});

app.post("/api/gpt/save-review", (req, res) => {
  const studentCode = normalizeStudentCode(req.body?.studentCode);
  const lessonId = String(req.body?.lessonId ?? "").trim();
  const review = req.body?.review;

  if (!lessonId || !review || typeof review.score !== "number") {
    return res.status(400).json({ error: "lessonId and review.score are required" });
  }

  const progress = getStudentProgress(studentCode);
  progress.lessons[lessonId] = {
    learned: true,
    aiScore: clampScore(review.score),
    verdict: String(review.verdict ?? ""),
    good: normalizeStringArray(review.good),
    missing: normalizeStringArray(review.missing),
    wrong: normalizeStringArray(review.wrong),
    termsToLearn: normalizeStringArray(review.termsToLearn),
    betterAnswer: String(review.betterAnswer ?? ""),
    nextTask: String(review.nextTask ?? ""),
    updatedAt: new Date().toISOString(),
  };

  return res.json({
    ok: true,
    studentCode,
    lessonId,
    saved: progress.lessons[lessonId],
    progressSummary: summarizeProgress(progress),
  });
});

app.post("/api/gpt/progress", (req, res) => {
  const studentCode = normalizeStudentCode(req.body?.studentCode);
  const progress = getStudentProgress(studentCode);

  return res.json({
    studentCode,
    progress,
    progressSummary: summarizeProgress(progress),
  });
});

app.get(/.*/, (_req, res) => {
  res.sendFile("index.html", { root: "dist" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`GOSI trainer server listening on http://0.0.0.0:${port}`);
});

function getSession(rawSessionId) {
  cleanupSessions();
  const sessionId = String(rawSessionId ?? "").trim().toUpperCase();
  return sessions.get(sessionId);
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > ttlMs) {
      sessions.delete(sessionId);
    }
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean).slice(0, 8);
}

function clampScore(score) {
  return Math.max(0, Math.min(5, Math.round(score)));
}

function normalizeStudentCode(value) {
  const code = String(value ?? "DEFAULT").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return code || "DEFAULT";
}

function getStudentProgress(studentCode) {
  if (!studentProgress.has(studentCode)) {
    studentProgress.set(studentCode, { lessons: {} });
  }
  return studentProgress.get(studentCode);
}

function summarizeProgress(progress) {
  const lessons = Object.values(progress.lessons);
  return {
    learned: lessons.filter((lesson) => lesson.learned).length,
    weak: lessons.filter((lesson) => lesson.aiScore <= 2).length,
    averageScore:
      lessons.length === 0
        ? null
        : lessons.reduce((sum, lesson) => sum + Number(lesson.aiScore ?? 0), 0) / lessons.length,
  };
}

function normalizeCurriculum(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((section) => ({
      id: Number(section?.id),
      title: String(section?.title ?? ""),
      lessons: Array.isArray(section?.lessons) ? section.lessons : [],
    }))
    .filter((section) => Number.isFinite(section.id) && section.title && section.lessons.length > 0);
}
