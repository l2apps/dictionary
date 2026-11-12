import { WORD_ANALYSIS_PROMPT, SENTENCE_EVALUATION_PROMPT, HINTS_GENERATION_PROMPT } from "./prompts.js";
import { MOCK_WORDS } from "./mockData.js";

const STORE_KEY = "vocab_words_v1";
const API_KEY = "GROQ_API_KEY";
const MAX_EX = 7;
const $ = (s, el = document) => el.querySelector(s);

/* ---------- Storage ---------- */
let store = loadStore();
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn(e); }
  const seeded = structuredClone(MOCK_WORDS);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(seeded)); } catch (e) {}
  return seeded;
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch (e) { toast("Không lưu được vào trình duyệt.", true); }
  $("#notebook-count").textContent = Object.keys(store).length;
}
const keyOf = (w) => w.trim().toLowerCase();
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Cache: từ đã tra (chưa lưu sổ tay) ---------- */
const CACHE_KEY = "vocab_cache_v1", CACHE_MAX = 300;
let cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } })();
function saveCache() {
  for (let i = 0; i < 3; i++) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); return; }
    catch { const keys = Object.keys(cache); keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => delete cache[k]); }
  }
}
function cachePut(entry) {
  const k = keyOf(entry.word);
  delete cache[k];
  cache[k] = { ...entry, saved: false, examples: [] };
  const keys = Object.keys(cache);
  keys.slice(0, Math.max(0, keys.length - CACHE_MAX)).forEach((x) => delete cache[x]);
  saveCache();
}

/* ---------- UI helpers ---------- */
let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (isError ? " error" : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3800);
}

/* ---------- APIs ---------- */
async function fetchMyMemory(word) {
  const out = { translations: [], examples: [] };
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|vi`);
    if (!res.ok) return out;
    const d = await res.json();
    if (Number(d.responseStatus) !== 200) return out;
    const re = new RegExp(`\\b${word}`, "i");
    const seen = new Set();
    for (const m of d.matches || []) {
      const seg = (m.segment || "").trim(), tr = (m.translation || "").trim();
      if (!tr || seen.has(tr.toLowerCase())) continue;
      if (seg.toLowerCase() === word.toLowerCase()) {
        seen.add(tr.toLowerCase());
        if (out.translations.length < 3) out.translations.push(tr);
      } else if (seg.length >= 15 && seg.length <= 140 && re.test(seg) && out.examples.length < 3) {
        seen.add(tr.toLowerCase()); out.examples.push({ en: seg, vi: tr });
      }
    }
    if (!out.translations.length && d.responseData?.translatedText) out.translations.push(d.responseData.translatedText);
  } catch (e) { console.warn("MyMemory lỗi:", e); }
  return out;
}

/* ---------- Usage counter (lượt sử dụng Groq) ---------- */
const USAGE_KEY = "groq_usage_v1";
const today = () => new Date().toLocaleDateString("sv");
let usage = loadUsage();
function loadUsage() {
  try { const u = JSON.parse(localStorage.getItem(USAGE_KEY)); if (u && u.date === today()) return u; } catch {}
  return { date: today(), count: 0, tokens: 0, remaining: null, limit: null };
}
function trackUsage(res, data) {
  usage = loadUsage(); usage.count++;
  usage.tokens += data?.usage?.total_tokens || 0;
  const rem = res.headers.get("x-ratelimit-remaining-requests"), lim = res.headers.get("x-ratelimit-limit-requests");
  if (rem !== null) { usage.remaining = Number(rem); usage.limit = Number(lim) || null; }
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch {}
  renderUsage();
}
function renderUsage() {
  const el = $("#usage");
  el.textContent = `⚡ Lượt sử dụng: ${usage.count}` + (usage.remaining != null ? ` · còn ${usage.remaining}${usage.limit ? "/" + usage.limit : ""}` : "");
  el.title = `Hôm nay (${usage.date}): ${usage.count} lượt gọi Groq, khoảng ${usage.tokens} tokens. Tự đếm lại từ 0 mỗi ngày.`;
}

async function callGroq(systemPrompt, payload) {
  const key = localStorage.getItem(API_KEY);
  if (!key) { openSettings(); throw new Error("Hãy nhập GROQ_API_KEY trong phần cài đặt."); }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: typeof payload === "string" ? payload : JSON.stringify(payload) }
      ]
    })
  });
  if (!res.ok) {
    trackUsage(res, null);
    if (res.status === 401) throw new Error("API Key không hợp lệ.");
    if (res.status === 429) throw new Error("Groq đang giới hạn tốc độ, thử lại sau ít giây.");
    throw new Error(`Groq lỗi ${res.status}.`);
  }
  const data = await res.json();
  trackUsage(res, data);
  try { return JSON.parse(data.choices[0].message.content); }
  catch { throw new Error("Groq trả về JSON không hợp lệ, hãy thử lại."); }
}

/* ---------- Views state (one per tab) ---------- */
const views = { lookup: null, notebook: null };
const mk = (entry) => ({ entry, hintLevel: 0, hints: null, lastEval: null, draft: "", busy: "" });

function speak(entry) {
  const fallback = () => {
    if (!("speechSynthesis" in window)) return toast("Trình duyệt không hỗ trợ phát âm.", true);
    const u = new SpeechSynthesisUtterance(entry.word); u.lang = "en-US"; speechSynthesis.speak(u);
  };
  if (!entry.audio) return fallback();
  const a = new Audio(entry.audio); a.play().catch(fallback);
}

/* ---------- Render: UnifiedWordView ---------- */
const MORPH = { prefix: "prefix", free_base: "free base", bound_base: "bound base", suffix: "suffix", inflectional_suffix: "inflection" };

function morphologyHTML(a) {
  const m = a.morphology || {}, parts = m.parts || [];
  const rel = m.related_words || a.etymology?.related_words || [];
  const hook = m.memory_hook || a.etymology?.memory_hook;
  const body = parts.length
    ? `<div class="morph">${parts.map((p) => `<span class="morph-part"><span class="morph-chip t-${esc(p.type)}">${esc(p.segment)}</span><span class="morph-type">${MORPH[p.type] || esc(p.type)}</span></span>`).join('<span class="plus">+</span>')}</div>
       <ul class="list">${parts.map((p) => `<li><b>${esc(p.segment)}</b>: ${esc(p.meaning)}</li>`).join("")}</ul>`
    : `<p><b>Cấu tạo:</b> ${esc(a.etymology?.breakdown)}</p>`;
  return `<section class="card"><h3>Cấu tạo từ (hình thái học)</h3>${body}${hook ? `<div class="hook">🧠 ${esc(hook)}</div>` : ""}<ul class="list">${rel.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>`;
}

function dictExamplesHTML(e) {
  const ai = e.analysis?.dictionary_examples || [], mm = e.mm_examples || [];
  if (!ai.length && !mm.length) return "";
  const row = (x) => `<li>${esc(x.en)}<br><span class="muted">${esc(x.vi)}</span></li>`;
  return `<section class="card"><h3>Ví dụ trong từ điển</h3><ul class="list">${ai.map(row).join("")}</ul>${mm.length ? `<h4 class="muted" style="margin-top:12px">Câu thực tế (MyMemory)</h4><ul class="list">${mm.map(row).join("")}</ul>` : ""}</section>`;
}

const scoreClass = (s) => (s >= 8 ? "" : s >= 6 ? "mid" : "low");

function exampleHTML(ex) {
  return `<article class="example">
    <div class="example-top">
      <p class="example-text">“${esc(ex.text)}”</p>
      <span class="score ${scoreClass(ex.score)}">${Number(ex.score).toFixed(1)}/10</span>
    </div>
    <p class="fb"><b>Ngữ pháp:</b> ${esc(ex.grammar_feedback)}</p>
    <p class="fb"><b>Sắc thái:</b> ${esc(ex.nuance_feedback)}</p>
    <div class="c1"><b>Bản sửa:</b> ${esc(ex.corrected_sentence)}<br><b>Nâng cấp C1:</b> ${esc(ex.c1_upgrade_sentence)}</div>
    <div class="actions"><button class="btn btn-danger" data-action="delete" data-id="${esc(ex.id)}">🗑️ Xoá câu này</button></div>
  </article>`;
}

function evalHTML(ev) {
  if (!ev) return "";
  return `<div class="example" style="border-color:var(--green)">
    <div class="example-top"><strong>Kết quả chấm</strong>
      <span class="score ${scoreClass(ev.score)}">${Number(ev.score).toFixed(1)}/10</span></div>
    <p class="fb"><b>Ngữ pháp:</b> ${esc(ev.grammar_feedback)}</p>
    <p class="fb"><b>Sắc thái:</b> ${esc(ev.nuance_feedback)}</p>
    <div class="c1"><b>Bản sửa:</b> ${esc(ev.corrected_sentence)}<br><b>Nâng cấp C1:</b> ${esc(ev.c1_upgrade_sentence)}</div>
    <p class="fb">${ev.is_valid ? "✅ Đã thêm vào bộ sưu tập ví dụ." : "⚠️ Câu chưa hợp lệ nên chưa được lưu. Hãy thử lại."}</p>
  </div>`;
}

function hintsHTML(v) {
  if (!v.hints || !v.hintLevel) return "";
  const rows = [
    ["Tầng 1 – Collocation", v.hints.hint_level_1_collocation],
    ["Tầng 2 – Khung câu", v.hints.hint_level_2_frame],
    ["Tầng 3 – Dịch ngược", v.hints.hint_level_3_translation]
  ];
  return rows.slice(0, v.hintLevel).map(([t, h]) => `<div class="hint"><b>💡 ${t}:</b> ${esc(h)}</div>`).join("");
}

function wordViewHTML(v) {
  const e = v.entry, a = e.analysis || {};
  const n = e.examples.length, pct = Math.round((n / MAX_EX) * 100);
  const et = a.etymology || {};
  const busy = (label, text) => (v.busy === label ? `<span class="spinner"></span>${text}…` : null);
  const dis = v.busy ? "disabled" : "";

  const challenge = n >= MAX_EX ? "" : `
    <section class="card">
      <h3>Thử thách đặt câu mới</h3>
      <div class="prompt-box">🎯 ${esc(e.context_prompt || "Hãy đặt một câu với từ này.")}</div>
      ${hintsHTML(v)}
      <textarea id="draft" placeholder="Viết câu tiếng Anh của bạn với “${esc(e.word)}”…" aria-label="Câu của bạn">${esc(v.draft)}</textarea>
      <div class="actions">
        <button class="btn btn-ghost" data-action="hint" ${dis}>${busy("hint", "Đang tạo gợi ý") || (v.hintLevel >= 3 ? "💡 Gợi ý (đã hết)" : "💡 Gợi ý từng bước")}</button>
        <button class="btn btn-ghost" data-action="newctx" ${dis}>${busy("newctx", "Đang đổi") || "🔄 Đổi bối cảnh"}</button>
        <button class="btn btn-primary" data-action="grade" ${dis}>${busy("grade", "Đang chấm") || "🚀 Chấm câu"}</button>
      </div>
      <div style="margin-top:14px">${evalHTML(v.lastEval)}</div>
    </section>`;

  return `<div class="wv-grid">
    <section class="card wv-head-card">
      <div class="wv-head">
        <div>
          <h2 class="wv-title">${esc(e.word)}</h2>
          <div class="meta">
            ${e.pos ? `<span class="badge">${esc(e.pos)}</span>` : ""}
            ${e.cefr ? `<span class="badge badge-gold">CEFR ${esc(e.cefr)}</span>` : ""}
            ${e.ipa ? `<span class="muted">${esc(e.ipa)}</span>` : ""}
            <button class="icon-btn" data-action="speak" aria-label="Phát âm">🔊</button>
          </div>
        </div>
        <button class="icon-btn star ${e.saved ? "is-on" : ""}" data-action="star" aria-pressed="${!!e.saved}" aria-label="${e.saved ? "Bỏ lưu" : "Lưu vào sổ tay"}">${e.saved ? "⭐" : "☆"}</button>
      </div>
    </section>

    <div>
      <section class="card">
        <h3>Giải nghĩa</h3>
        <p class="wv-meaning">${esc(a.vietnamese_meaning)}</p>
        ${e.mm_translations?.length ? `<p class="muted">Dịch tham khảo (MyMemory): ${e.mm_translations.map(esc).join(" · ")}</p>` : ""}
        <p>${esc(a.simple_explanation)}</p>
        ${e.definition_en ? `<p class="quote">${esc(e.definition_en)}</p>` : ""}
      </section>
      ${morphologyHTML(a)}
      ${dictExamplesHTML(e)}
      <section class="card">
        <h3>Cụm từ cố định</h3>
        <ul class="list">${(a.collocations || []).map((c) => `<li><b>${esc(c.phrase)}</b> – ${esc(c.meaning)}</li>`).join("")}</ul>
        <h3 style="margin-top:14px">Phân biệt sắc thái</h3>
        <p>${esc(a.nuance_comparison)}</p>
      </section>
    </div>

    <div>
      <section class="card">
        <h3>Ví dụ của bạn: ${n}/${MAX_EX}</h3>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${MAX_EX}" aria-valuenow="${n}"><span style="width:${pct}%"></span></div>
        ${n >= MAX_EX ? `<div class="mastered">🏆 Đã làm chủ từ vựng (Mastered)</div>` : ""}
        ${n ? e.examples.map(exampleHTML).join("") : `<p class="muted">Chưa có câu nào. Hãy đặt câu đầu tiên bên dưới.</p>`}
      </section>
      ${challenge}
    </div>
  </div>`;
}

function render(key) {
  const v = views[key];
  const box = $(key === "lookup" ? "#lookup-view" : "#notebook-view");
  if (!v) return;
  const active = document.activeElement?.id;
  box.innerHTML = (key === "notebook" ? `<div class="actions back"><button class="btn btn-ghost" data-action="back">← Về Sổ tay</button><button class="btn btn-danger" data-action="delword">🗑️ Xoá từ khỏi Sổ tay</button></div>` : "") + wordViewHTML(v);
  if (active === "draft") { const t = $("#draft", box); t?.focus(); t?.setSelectionRange(t.value.length, t.value.length); }
}

/* ---------- Actions ---------- */
async function lookupWord(raw) {
  const word = raw.trim();
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return toast("Hãy nhập một từ tiếng Anh hợp lệ.", true);
  const k = keyOf(word);
  if (store[k]) { views.lookup = mk(store[k]); return render("lookup"); }
  if (cache[k]) { views.lookup = mk(structuredClone(cache[k])); return render("lookup"); }
  $("#lookup-view").innerHTML = `<p class="empty"><span class="spinner"></span>Đang phân tích “${esc(word)}”…</p>`;
  try {
    const [mm, ai] = await Promise.all([fetchMyMemory(word), callGroq(WORD_ANALYSIS_PROMPT, word)]);
    const entry = {
      word: ai.word || word, pos: ai.part_of_speech || "", ipa: ai.ipa || "", audio: "",
      definition_en: ai.english_definition || "", cefr: ai.cefr_level, saved: false,
      analysis: ai, mm_translations: mm.translations, mm_examples: mm.examples,
      context_prompt: ai.initial_context_prompt, examples: []
    };
    views.lookup = mk(entry);
    cachePut(entry);
    render("lookup");
  } catch (err) {
    $("#lookup-view").innerHTML = `<p class="empty">Không tra được từ này. ${esc(err.message)}</p>`;
    toast(err.message, true);
  }
}

function setSaved(entry, saved) {
  entry.saved = saved;
  if (saved) { store[keyOf(entry.word)] = entry; delete cache[keyOf(entry.word)]; saveCache(); }
  else { delete store[keyOf(entry.word)]; cachePut(entry); }
  persist(); renderList();
}

async function handleAction(key, action, target) {
  const v = views[key]; if (!v) return;
  const e = v.entry;
  try {
    if (action === "speak") return speak(e);
    if (action === "back") { views.notebook = null; showNotebookList(); return; }
    if (action === "delword") {
      if (!confirm(`Xoá “${e.word}” khỏi Sổ tay?`)) return;
      setSaved(e, false); views.notebook = null; showNotebookList(); return;
    }
    if (action === "star") {
      if (e.saved && e.examples.length && !confirm("Bỏ lưu sẽ xoá từ và các câu ví dụ khỏi Sổ tay. Tiếp tục?")) return;
      setSaved(e, !e.saved);
      if (key === "notebook" && !e.saved) { views.notebook = null; showNotebookList(); return; }
      return render(key);
    }
    if (action === "delete") {
      e.examples = e.examples.filter((x) => x.id !== target.dataset.id);
      if (e.saved) persist(); renderList(); return render(key);
    }
    if (action === "hint") {
      if (v.hintLevel >= 3) return toast("Bạn đã xem hết 3 tầng gợi ý.");
      if (!v.hints) {
        v.busy = "hint"; render(key);
        v.hints = await callGroq(HINTS_GENERATION_PROMPT, { target_word: e.word, current_context: e.context_prompt, note: "Hints must fit the current_context. Ignore new_context_prompt." });
        v.busy = "";
      }
      v.hintLevel++; return render(key);
    }
    if (action === "newctx") {
      v.busy = "newctx"; render(key);
      const h = await callGroq(HINTS_GENERATION_PROMPT, { target_word: e.word, current_context: e.context_prompt, note: "The user wants a different context: make new_context_prompt fresh and make all 3 hints fit that new_context_prompt." });
      e.context_prompt = h.new_context_prompt || e.context_prompt;
      v.hints = h; v.hintLevel = 0; v.lastEval = null; v.busy = "";
      if (e.saved) persist();
      return render(key);
    }
    if (action === "grade") {
      const sentence = v.draft.trim();
      if (sentence.split(/\s+/).length < 3) return toast("Hãy viết một câu đầy đủ trước khi chấm.", true);
      v.busy = "grade"; render(key);
      const ev = await callGroq(SENTENCE_EVALUATION_PROMPT, { target_word: e.word, context: e.context_prompt, user_sentence: sentence });
      v.busy = ""; v.lastEval = ev;
      if (ev.is_valid) {
        e.examples.push({
          id: "ex-" + Date.now(), text: sentence, score: Number(ev.score) || 0,
          grammar_feedback: ev.grammar_feedback, nuance_feedback: ev.nuance_feedback,
          corrected_sentence: ev.corrected_sentence, c1_upgrade_sentence: ev.c1_upgrade_sentence
        });
        if (ev.next_context_prompt) e.context_prompt = ev.next_context_prompt;
        v.draft = ""; v.hints = null; v.hintLevel = 0;
        if (!e.saved) { setSaved(e, true); toast("⭐ Đã tự động lưu từ vào Sổ tay!"); }
        else { persist(); renderList(); }
      }
      return render(key);
    }
  } catch (err) {
    v.busy = ""; render(key); toast(err.message, true);
  }
}

/* ---------- Notebook list ---------- */
let filter = "all";
function renderList() {
  $("#notebook-count").textContent = Object.keys(store).length;
  const q = $("#nb-search").value.trim().toLowerCase();
  const items = Object.values(store).filter((w) => {
    const n = w.examples.length;
    const okF = filter === "all" || (filter === "zero" && n === 0) || (filter === "progress" && n > 0 && n < MAX_EX) || (filter === "done" && n >= MAX_EX);
    const okQ = !q || w.word.toLowerCase().includes(q) || (w.analysis?.vietnamese_meaning || "").toLowerCase().includes(q);
    return okF && okQ;
  });
  $("#nb-list").innerHTML = items.length ? items.map((w) => {
    const n = w.examples.length;
    return `<div class="word-card" data-word="${esc(keyOf(w.word))}" role="button" tabindex="0">
      <button class="icon-btn del" data-del="${esc(keyOf(w.word))}" aria-label="Xoá từ">🗑️</button>
      <h3>${esc(w.word)}</h3>
      <div class="muted">${esc(w.ipa)}</div>
      <p>${esc(w.analysis?.vietnamese_meaning)}</p>
      <div class="stars">${"⭐".repeat(n)}${"☆".repeat(MAX_EX - n)} (${n}/${MAX_EX})</div>
    </div>`;
  }).join("") : `<p class="empty" style="grid-column:1/-1">Chưa có từ nào phù hợp. Hãy tra từ mới và bấm ⭐ để lưu.</p>`;
}
function showNotebookList() { $("#notebook-view").hidden = true; $("#notebook-list-wrap").hidden = false; renderList(); }

/* ---------- Settings ---------- */
function openSettings() { $("#api-key-input").value = localStorage.getItem(API_KEY) || ""; $("#settings-dialog").showModal(); }

/* ---------- Events ---------- */
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === b));
  $("#tab-lookup").hidden = b.dataset.tab !== "lookup";
  $("#tab-notebook").hidden = b.dataset.tab !== "notebook";
  if (b.dataset.tab === "notebook") { if (!views.notebook) showNotebookList(); }
}));

$("#lookup-form").addEventListener("submit", (ev) => { ev.preventDefault(); lookupWord($("#lookup-input").value); });
$("#settings-btn").addEventListener("click", openSettings);
$("#settings-form").addEventListener("submit", (ev) => {
  if (ev.submitter?.id === "save-key") {
    const k = $("#api-key-input").value.trim();
    if (k) { localStorage.setItem(API_KEY, k); toast("Đã lưu API Key."); }
  }
});
$("#nb-search").addEventListener("input", renderList);
$("#nb-filters").addEventListener("click", (ev) => {
  const c = ev.target.closest(".chip"); if (!c) return;
  filter = c.dataset.filter;
  document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("is-active", x === c));
  renderList();
});
$("#nb-list").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.classList.contains("word-card")) ev.target.click(); });
$("#nb-list").addEventListener("click", (ev) => {
  const del = ev.target.closest("[data-del]");
  if (del) { const w = store[del.dataset.del]; if (w && confirm(`Xoá “${w.word}” khỏi Sổ tay?`)) setSaved(w, false); return; }
  const card = ev.target.closest(".word-card"); if (!card) return;
  views.notebook = mk(store[card.dataset.word]);
  $("#notebook-list-wrap").hidden = true; $("#notebook-view").hidden = false;
  render("notebook"); window.scrollTo({ top: 0 });
});
for (const key of ["lookup", "notebook"]) {
  const box = $(key === "lookup" ? "#lookup-view" : "#notebook-view");
  box.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-action]"); if (t) handleAction(key, t.dataset.action, t);
  });
  box.addEventListener("input", (ev) => { if (ev.target.id === "draft" && views[key]) views[key].draft = ev.target.value; });
}

persist();
renderList();
renderUsage();
