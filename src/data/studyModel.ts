import type { SectionMeta, TheoryBlock, Ticket } from "../types";
import { section1Tickets } from "./tickets/section1";
import { section2Tickets } from "./tickets/section2";
import { section3Tickets } from "./tickets/section3";
import { section4Tickets } from "./tickets/section4";
import { section5Tickets } from "./tickets/section5";
import { section6Tickets } from "./tickets/section6";
import { section7Tickets } from "./tickets/section7";
import { section8Tickets } from "./tickets/section8";
import { section9Tickets } from "./tickets/section9";
import { extraQuiz, microChecks, ticketLinks } from "./extras";
import { extraQuiz16, microChecks16 } from "./extras-1-6";
import { cheatSheets, examinerProvocations, extraPractice, extraPracticeMore, hardQuiz } from "./extras-hard";
import { extraTheory } from "./extras-theory";

function mergeQuiz(...maps: Record<string, typeof extraQuiz[string]>[]): Record<string, typeof extraQuiz[string]> {
  const out: Record<string, typeof extraQuiz[string]> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      out[k] = [...(out[k] ?? []), ...v];
    }
  }
  return out;
}

const allExtraQuiz = mergeQuiz(extraQuiz16, extraQuiz, hardQuiz);

const allMicroChecks: Record<string, typeof microChecks[string]> = {
  ...microChecks16,
  ...microChecks,
};

function enrichTicket(ticket: Ticket): Ticket {
  // Слить дополнительные вопросы.
  const extra = allExtraQuiz[ticket.id] ?? [];
  const quizMap = new Map(ticket.quiz.map((q) => [q.id, q]));
  for (const q of extra) {
    if (!quizMap.has(q.id)) quizMap.set(q.id, q);
  }
  const quiz = Array.from(quizMap.values());

  // Расширить теорию: оригинал + extraTheory + микро-квизы.
  let theory: TheoryBlock[] = [
    ...ticket.theory,
    ...(extraTheory[ticket.id] ?? []),
  ];
  const checks = allMicroChecks[ticket.id];
  if (checks && checks.length > 0) {
    const sorted = [...checks].sort((a, b) => b.afterIndex - a.afterIndex);
    for (const c of sorted) {
      const idx = Math.min(c.afterIndex, theory.length - 1);
      theory.splice(idx + 1, 0, c.check);
    }
  }

  // Слить дополнительные практические задачи.
  const extraTasks = [
    ...(extraPractice[ticket.id] ?? []),
    ...(extraPracticeMore[ticket.id] ?? []),
  ];
  const practice =
    ticket.practice || extraTasks.length > 0
      ? [...(ticket.practice ?? []), ...extraTasks]
      : undefined;

  return {
    ...ticket,
    quiz,
    theory,
    practice,
    relatedTicketIds: ticketLinks[ticket.id],
    cheatSheet: cheatSheets[ticket.id],
    examinerProvocations: examinerProvocations[ticket.id],
  };
}

export const sections: SectionMeta[] = [
  {
    id: 1,
    number: "I",
    shortTitle: "Программирование и БД",
    title: "Объектно-ориентированное программирование, базы данных",
    kind: "theory",
    intro:
      "Раздел про то, как из алгоритма, кода, объектов, интерфейса и базы данных получается обычная информационная система.",
    bigPicture: [
      "Программа получает данные, выполняет команды, хранит результат и показывает интерфейс.",
      "Первые билеты: алгоритмические конструкции — условия, циклы, функции, массивы.",
      "Дальше — ООП: способ не утонуть в большом коде через классы, наследование и полиморфизм.",
      "Интерфейс — слой взаимодействия с пользователем; БД и SQL — где живут данные приложения.",
    ],
  },
  {
    id: 2,
    number: "II",
    shortTitle: "Low-code",
    title: "Low-code технологии и конструирование ПО",
    kind: "theory",
    intro:
      "Раздел про создание информационных систем быстрее обычной разработки за счёт визуальных конструкторов и готовых модулей.",
    bigPicture: [
      "Low-code — мало ручного кода, но проектирование и архитектура остаются.",
      "Главные слои: данные, бизнес-процессы, интерфейсы, интеграции, безопасность.",
      "Российский рынок активно растёт: Creatio, ELMA365, BPMSoft, PIX.",
      "Подходит для корпоративных приложений; не для real-time и нестандартных алгоритмов.",
    ],
  },
  {
    id: 3,
    number: "III",
    shortTitle: "ИИ в дизайне",
    title: "Системы искусственного интеллекта и нейросетевые инструменты в дизайне",
    kind: "theory",
    intro:
      "Раздел про то, как ИИ помогает дизайнеру быстрее искать идеи, делать варианты, мокапы и иллюстрации, не снимая ответственности за качество и права.",
    bigPicture: [
      "Промпт — главная инструкция нейросети: роль, задача, контекст, ограничения, формат.",
      "ИИ автоматизирует рутину: фоны, ретушь, мудборды, паттерны.",
      "Этические и правовые вопросы — лицензии, оригинальность, лица людей, NDA.",
      "Реальная работа дизайнера — связка нейросетей с Figma/Photoshop/Illustrator/Blender.",
    ],
  },
  {
    id: 4,
    number: "IV",
    shortTitle: "Дизайн и тексты",
    title: "Графический дизайн, UX-копирайтинг и цифровой контент",
    kind: "theory",
    intro:
      "Раздел про то, как визуал и текст вместе помогают пользователю понять сообщение: типографика, иллюстрация, композиция, материалы и UX-копирайтинг.",
    bigPicture: [
      "Типографика — читаемость, иерархия, характер.",
      "Композиция — управление вниманием через баланс, ритм, акценты.",
      "Иллюстрация — коммуникация идеи и узнаваемость бренда.",
      "Контент бывает разный (репутационный, полезный, продающий и т. д.); UX-текст — отдельная дисциплина.",
    ],
  },
  {
    id: 5,
    number: "V",
    shortTitle: "Аналитика и брендинг",
    title: "Веб-аналитика и брендинг в высокотехнологичных отраслях",
    kind: "theory",
    intro:
      "Раздел про то, как данные помогают понимать аудиторию, а бренд помогает объяснять сложный технологический продукт и вызывать доверие.",
    bigPicture: [
      "Веб-аналитика прошла путь от логов и счётчиков до сквозной аналитики и AI-инсайтов.",
      "Цель → метрика → анализ → решение — главная цепочка.",
      "Технологичный бренд требует понятного позиционирования и системной коммуникации.",
      "Brand Health Tracking превращает «бренд» в управляемую систему с метриками.",
    ],
  },
  {
    id: 6,
    number: "VI",
    shortTitle: "Проекты и PLM",
    title: "Управление проектами и полным жизненным циклом продукта",
    kind: "theory",
    intro:
      "Раздел про то, как управлять работой с целью, сроками, рисками, командой, качеством и продуктом на всём жизненном цикле.",
    bigPicture: [
      "Проект — временная уникальная деятельность с тройным ограничением.",
      "Жизненный цикл и стандарты (PMBOK, ГОСТ Р 54869) задают общий язык.",
      "Управление рисками, изменениями, командой и качеством — отдельные практики.",
      "PLM связывает идею, проектирование, производство и эксплуатацию в единый поток данных.",
    ],
  },
  {
    id: 7,
    number: "VII",
    shortTitle: "Эконометрика",
    title: "Эконометрика: корреляция, регрессия, прогноз",
    kind: "case",
    intro:
      "Раздел учится как одна цепочка: нашли связь между переменными, построили регрессию, проверили значимость, оценили качество и сделали прогноз.",
    bigPicture: [
      "Корреляция показывает силу связи; не доказывает причину.",
      "МНК даёт коэффициенты линейной регрессии при предпосылках Гаусса-Маркова.",
      "t-тест проверяет отдельные параметры; F-тест — модель в целом; R² — качество.",
      "Прогноз должен идти с интервалом, особенно при удалении от среднего X.",
    ],
  },
  {
    id: 8,
    number: "VIII",
    shortTitle: "Эконом-модели",
    title: "Экономико-математическое моделирование",
    kind: "case",
    intro:
      "Раздел про модели поведения производителя, потребителя и рынка: каждая модель имеет предпосылки, переменные и экономический смысл.",
    bigPicture: [
      "Производственная функция связывает ресурсы и выпуск; имеет аксиомы и отдачу от масштаба.",
      "Теория потребления формализует выбор через предпочтения и полезность.",
      "Спрос Маршалла — некомпенсированный, Хикса — компенсированный.",
      "Динамические модели (паутина, ВЭС) объясняют, как рынок приходит к равновесию.",
    ],
  },
  {
    id: 9,
    number: "IX",
    shortTitle: "Оптимизация",
    title: "Методы оптимальных решений",
    kind: "case",
    intro:
      "Раздел про то, как выбрать лучший вариант при ограничениях: максимум прибыли, минимум затрат, лучшее распределение ресурсов.",
    bigPicture: [
      "Любая задача оптимизации = переменные + целевая функция + ограничения.",
      "Графический метод — для двух переменных; симплекс — для любого числа.",
      "Задача о назначениях решается венгерским методом.",
      "Транспортная задача — закрытая или открытая, решается методом потенциалов.",
    ],
  },
];

export const allTickets: Ticket[] = [
  ...section1Tickets,
  ...section2Tickets,
  ...section3Tickets,
  ...section4Tickets,
  ...section5Tickets,
  ...section6Tickets,
  ...section7Tickets,
  ...section8Tickets,
  ...section9Tickets,
].map(enrichTicket);

export const ticketsBySection: Record<number, Ticket[]> = allTickets.reduce<Record<number, Ticket[]>>(
  (acc, ticket) => {
    if (!acc[ticket.sectionId]) acc[ticket.sectionId] = [];
    acc[ticket.sectionId].push(ticket);
    return acc;
  },
  {},
);

export function getSection(id: number): SectionMeta {
  return sections.find((section) => section.id === id) ?? sections[0];
}

export function getTicket(id: string): Ticket | undefined {
  return allTickets.find((ticket) => ticket.id === id);
}

export function getSectionTickets(id: number): Ticket[] {
  return ticketsBySection[id] ?? [];
}

export const totalTicketsCount = allTickets.length;
