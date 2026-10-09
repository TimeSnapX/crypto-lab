import { h, card, toast } from "../ui.js";
import { load, save } from "../store.js";
import { LESSONS, GLOSSARY, QUIZ, LINKS } from "../learn-data.js";

export async function render(root) {
  const prog = load("learn", { done: [], quiz: null });
  const path = card("Start here: beginner path");
  const quiz = card("Quiz");
  const glos = card("Glossary");
  const links = card("Learn more: trusted sources");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Learn"), h("p", {}, "Ten short lessons, a quiz and a glossary. Progress saves on this device.")), path, quiz, glos, links);

  const paintPath = () => {
    const pctDone = Math.round((prog.done.length / LESSONS.length) * 100);
    path.replaceChildren(h("h2", {}, "Start here: beginner path"), h("p", { "data-k": "lessons" }, `${prog.done.length}/${LESSONS.length} lessons done`), h("div", { class: "progress" }, h("i", { style: `width:${pctDone}%` })),
      ...LESSONS.map((l) => {
        const done = prog.done.includes(l.id);
        return h("details", { "data-lesson": l.id }, h("summary", {}, `${done ? "✅ " : ""}${l.title}`), ...l.body.map((p) => h("p", {}, p)),
          h("button", { class: done ? "small" : "small primary", onclick: () => { prog.done = done ? prog.done.filter((x) => x !== l.id) : [...prog.done, l.id]; save("learn", prog); paintPath(); } }, done ? "Mark as not done" : "Mark as done"));
      }));
  };
  paintPath();

  let i = 0, score = 0, answered = false;
  const paintQuiz = () => {
    if (i >= QUIZ.length) {
      const best = Math.max(score, prog.quiz?.best || 0);
      prog.quiz = { best, last: score, total: QUIZ.length, at: Date.now() }; save("learn", prog);
      quiz.replaceChildren(h("h2", {}, "Quiz"), h("p", { class: "big", "data-k": "score" }, `${score}/${QUIZ.length}`), h("p", {}, score >= 13 ? "Excellent!" : score >= 9 ? "Solid. Review the lessons you missed." : "Keep going: try the lessons then retake it."), h("p", { class: "muted" }, `Best: ${best}/${QUIZ.length}`), h("button", { class: "primary", onclick: () => { i = 0; score = 0; paintQuiz(); } }, "Retake"));
      return;
    }
    const item = QUIZ[i]; answered = false;
    const fb = h("p");
    const next = h("button", { class: "primary", disabled: true, onclick: () => { i++; paintQuiz(); } }, i === QUIZ.length - 1 ? "See score" : "Next →");
    quiz.replaceChildren(h("h2", {}, "Quiz"), h("p", { class: "muted" }, `Question ${i + 1} of ${QUIZ.length} · score ${score}${prog.quiz ? ` · best ${prog.quiz.best}/${prog.quiz.total}` : ""}`), h("p", {}, h("b", {}, item.q)),
      ...item.a.map((a, k) => h("button", { class: "quiz-opt", "data-opt": k, onclick: (e) => {
        if (answered) return; answered = true;
        const right = k === item.c; if (right) score++;
        e.currentTarget.classList.add(right ? "right" : "wrong");
        quiz.querySelectorAll(".quiz-opt")[item.c].classList.add("right");
        fb.replaceChildren(right ? "✅ Correct" : `❌ The answer is: ${item.a[item.c]}`); next.disabled = false;
      } }, a)), fb, next);
  };
  paintQuiz();

  const search = h("input", { type: "search", placeholder: "Search terms…", "aria-label": "Search glossary" });
  const list = h("dl");
  const paintGlos = () => { const q = search.value.toLowerCase(); list.replaceChildren(...GLOSSARY.filter(([t, d]) => !q || (t + d).toLowerCase().includes(q)).flatMap(([t, d]) => [h("dt", {}, h("b", {}, t)), h("dd", { class: "muted", style: "margin:0 0 8px" }, d)])); };
  search.addEventListener("input", paintGlos);
  glos.append(search, list); paintGlos();

  links.append(h("p", { class: "muted" }, "Links open the official sites. Crypto Lab doesn't copy or scrape their content."), h("ul", { class: "list" }, LINKS.map(([t, u, d]) => h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, t + " ↗"), h("br"), h("small", {}, d)))));
  if (location.hash.includes("quiz")) setTimeout(() => quiz.scrollIntoView({ behavior: "smooth" }), 50);
}
