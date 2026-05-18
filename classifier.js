/**
 * classifier.js — Detect task type and language from a rough prompt.
 * Runs entirely in the browser. Zero network calls.
 */

const PF_TASK_KEYWORDS = {
  implement: [
    "build","create","implement","write","develop","add","make",
    "scaffold","generate","set up","setup","bootstrap","integrate",
    "add feature","new feature","from scratch",
  ],
  debug: [
    "fix","bug","error","broken","not working","crash","crashes",
    "crashing","issue","failing","fails","exception","traceback",
    "race condition","deadlock","memory leak","doesn't work",
    "wrong output","unexpected","diagnose","investigate","root cause",
  ],
  refactor: [
    "refactor","clean up","cleanup","improve","restructure",
    "simplify","decouple","extract","consolidate","rename",
    "reorganise","reorganize","modularise","modularize",
  ],
  review: [
    "review","audit","check","evaluate","assess","critique",
    "feedback on","look at","is this good","code quality",
  ],
  design: [
    "design","architect","architecture","schema","data model",
    "api design","system design","plan","blueprint","how should i",
    "structure","approach","strategy","pattern",
  ],
  test: [
    "test","tests","unit test","integration test","e2e","end-to-end",
    "spec","coverage","mock","stub","tdd","bdd","pytest","jest",
    "playwright","cypress","assertion","test suite",
  ],
  optimize: [
    "optimize","optimise","slow","performance","latency","speed up",
    "memory","profil","bottleneck","n+1","cache","faster",
    "efficient","throughput","reduce cost",
  ],
  explain: [
    "explain","understand","how does","what does","walk me through",
    "document","comment","what is","describe","breakdown",
  ],
  security: [
    "security","secure","vulnerability","vulnerabilities","injection",
    "xss","cross-site scripting","csrf","cross-site request",
    "authentication","authorization","auth","permission",
    "sql injection","input validation","sanitize","sanitise",
    "encrypt","harden","attack","exploit","owasp","pentest",
    "privilege escalation","insecure",
  ],
};

const PF_PRIORITY = [
  "security","debug","optimize","test","review",
  "refactor","design","explain","implement",
];

const PF_LEADING_VERB_MAP = [
  { re: /^\s*(audit|pen.?test|find.*vuln|check.*security|check.*vuln|check.*xss|check.*inject)\b/i, task: "security",  bonus: 5 },
  { re: /^\s*(review|critique|evaluate|assess)\b/i,                                                  task: "review",    bonus: 4 },
  { re: /^\s*(refactor|clean\s+up|restructure|simplify)\b/i,                                         task: "refactor",  bonus: 4 },
  { re: /^\s*(debug|fix|diagnose|investigate)\b/i,                                                   task: "debug",     bonus: 4 },
  { re: /^\s*(optimis?e|speed\s+up|profile)\b/i,                                                     task: "optimize",  bonus: 4 },
  { re: /^\s*(explain|document|walk\s+me|describe)\b/i,                                              task: "explain",   bonus: 4 },
  { re: /^\s*(write|add|create|generate|set\s+up)\b.{0,60}\btest/i,                                  task: "test",      bonus: 5 },
  { re: /^\s*(build|create|implement|write|develop|add|make|scaffold|set\s+up)\b/i,                  task: "implement", bonus: 3 },
];

const PF_LANG_MAP = {
  python:     ["python","fastapi","django","flask","pydantic","numpy","pandas"],
  typescript: ["typescript","tsx"],
  javascript: ["javascript","node","express","react","vue","angular","next.js","nextjs"],
  rust:       ["rust","cargo","tokio","actix"],
  go:         ["golang"],
  java:       ["java","spring","maven","gradle"],
  "c++":      ["c++","cpp","cmake"],
  "c#":       [".net","dotnet","asp.net"],
  swift:      ["swift","swiftui","ios","xcode"],
  kotlin:     ["kotlin","android"],
  sql:        ["sql","postgres","postgresql","mysql","sqlite","mongodb"],
  bash:       ["bash","shell"],
};

function pfDetectTask(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const t of Object.keys(PF_TASK_KEYWORDS)) scores[t] = 0;

  for (const [task, kws] of Object.entries(PF_TASK_KEYWORDS)) {
    for (const kw of kws) {
      const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("\\b" + esc + "\\b").test(lower)) scores[task]++;
    }
  }

  // Leading verb boost
  for (const { re, task, bonus } of PF_LEADING_VERB_MAP) {
    if (re.test(text)) { scores[task] += bonus; break; }
  }

  // Strong security override
  if (scores.security >= 3) scores.security += 4;

  const best = Math.max(...Object.values(scores));
  if (best === 0) return "implement";
  for (const t of PF_PRIORITY) {
    if (scores[t] === best) return t;
  }
  return "implement";
}

function pfDetectLanguage(text) {
  const lower = text.toLowerCase();
  for (const [lang, hints] of Object.entries(PF_LANG_MAP)) {
    for (const h of hints) {
      const esc = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("\\b" + esc + "\\b").test(lower)) return lang;
    }
  }
  return null;
}
