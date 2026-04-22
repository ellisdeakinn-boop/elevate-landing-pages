// ── Constants ──
const AIRTABLE_BASE = "appbjYzgDlfEGeR6C";
const AIRTABLE_TABLE = "tblXXcTrlbPnPbq4u";
const CLOSER_RATE = 0.10;
const SETTER_RATE = 0.05;

// ── Init ──
function init() {
  const airtableKey = localStorage.getItem("cc_airtable_key");
  const anthropicKey = localStorage.getItem("cc_anthropic_key");

  if (!airtableKey || !anthropicKey) {
    show("setup-screen");
  } else {
    show("app");
    loadCommissions();
  }
}

function saveSetup() {
  const ak = document.getElementById("setup-airtable-key").value.trim();
  const ck = document.getElementById("setup-anthropic-key").value.trim();
  if (!ak || !ck) {
    alert("Both keys are required.");
    return;
  }
  localStorage.setItem("cc_airtable_key", ak);
  localStorage.setItem("cc_anthropic_key", ck);
  hide("setup-screen");
  show("app");
  loadCommissions();
}

function showSetup() {
  const ak = localStorage.getItem("cc_airtable_key") || "";
  const ck = localStorage.getItem("cc_anthropic_key") || "";
  document.getElementById("setup-airtable-key").value = ak;
  document.getElementById("setup-anthropic-key").value = ck;
  hide("app");
  show("setup-screen");
}

// ── Tab Switching ──
function switchTab(name, btn) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-" + name).classList.remove("hidden");
  btn.classList.add("active");
}

// ── Utility ──
function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }
function fmt(n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function getMonthFilter() {
  const period = document.getElementById("period-select").value;
  if (period === "all") return null;
  const now = new Date();
  if (period === "current") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonth(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // "YYYY-MM"
}

// ── Airtable Fetch ──
async function fetchDeals() {
  const key = localStorage.getItem("cc_airtable_key");
  let records = [];
  let offset = null;

  const params = new URLSearchParams({
    "filterByFormula": "AND({Cash Collected} > 0, {Raw Text (Closer Assigned)} != '')",
    "fields[]": ["Revenue", "Cash Collected", "Purchase Date", "Raw Text (Closer Assigned)", "Raw Text (Set By)", "Lead Name"],
    "pageSize": "100",
  });

  do {
    if (offset) params.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?${params}`, {
      headers: { "Authorization": `Bearer ${key}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Airtable error ${res.status}`);
    }
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset || null;
  } while (offset);

  return records;
}

// ── Build Summary ──
function buildSummary(records, monthFilter) {
  const closers = {};
  const setters = {};

  for (const rec of records) {
    const f = rec.fields || {};
    const closer = (f["Raw Text (Closer Assigned)"] || "").trim();
    const setter = (f["Raw Text (Set By)"] || "").trim();
    const revenue = parseFloat(f["Revenue"] || 0);
    const cash = parseFloat(f["Cash Collected"] || 0);
    const lead = f["Lead Name"] || "Unknown";
    const month = parseMonth(f["Purchase Date"]) || "Unknown";

    if (monthFilter && month !== monthFilter) continue;

    if (closer) {
      if (!closers[closer]) closers[closer] = { revenue: 0, cash: 0, commission: 0, deals: [] };
      closers[closer].revenue += revenue;
      closers[closer].cash += cash;
      closers[closer].commission += cash * CLOSER_RATE;
      closers[closer].deals.push({ lead, revenue, cash, commission: cash * CLOSER_RATE });
    }

    if (setter) {
      if (!setters[setter]) setters[setter] = { revenue: 0, cash: 0, commission: 0, deals: [] };
      setters[setter].revenue += revenue;
      setters[setter].cash += cash;
      setters[setter].commission += cash * SETTER_RATE;
      setters[setter].deals.push({ lead, revenue, cash, commission: cash * SETTER_RATE });
    }
  }

  return { closers, setters };
}

// ── Render Commissions ──
function renderRepCards(data, containerId) {
  const container = document.getElementById(containerId);
  const reps = Object.keys(data).sort();

  if (!reps.length) {
    container.innerHTML = '<p style="color:var(--muted);padding:.5rem 0">No records for this period.</p>';
    return;
  }

  container.innerHTML = reps.map(rep => {
    const d = data[rep];
    const dealsHtml = d.deals.map(deal => `
      <div class="deal-row">
        <span class="deal-lead">${deal.lead}</span>
        <div class="deal-nums">
          <span>Rev ${fmt(deal.revenue)}</span>
          <span>Collected ${fmt(deal.cash)}</span>
          <span class="deal-commission">Commission ${fmt(deal.commission)}</span>
        </div>
      </div>
    `).join("");

    return `
      <div class="rep-card">
        <div class="rep-header" onclick="toggleDeals(this)">
          <div>
            <div class="rep-name">${rep}</div>
            <div class="rep-meta" style="margin-top:.25rem">
              <span>${d.deals.length} deal${d.deals.length !== 1 ? "s" : ""}</span>
              <span>Rev ${fmt(d.revenue)}</span>
              <span>Collected ${fmt(d.cash)}</span>
            </div>
          </div>
          <div class="rep-owed">${fmt(d.commission)} owed</div>
        </div>
        <div class="rep-deals hidden">${dealsHtml}</div>
      </div>
    `;
  }).join("");
}

function toggleDeals(header) {
  const deals = header.nextElementSibling;
  deals.classList.toggle("hidden");
}

async function loadCommissions() {
  const monthFilter = getMonthFilter();
  show("commissions-loading");
  hide("commissions-error");
  hide("totals-bar");

  try {
    const records = await fetchDeals();
    const { closers, setters } = buildSummary(records, monthFilter);

    let totalRevenue = 0, totalCash = 0, totalCloserComm = 0, totalSetterComm = 0;

    for (const d of Object.values(closers)) {
      totalRevenue += d.revenue;
      totalCash += d.cash;
      totalCloserComm += d.commission;
    }
    for (const d of Object.values(setters)) {
      totalSetterComm += d.commission;
    }

    document.getElementById("total-revenue").textContent = fmt(totalRevenue);
    document.getElementById("total-cash").textContent = fmt(totalCash);
    document.getElementById("total-closer-comm").textContent = fmt(totalCloserComm);
    document.getElementById("total-setter-comm").textContent = fmt(totalSetterComm);
    document.getElementById("total-payroll").textContent = fmt(totalCloserComm + totalSetterComm);

    show("totals-bar");
    renderRepCards(closers, "closers-table");
    renderRepCards(setters, "setters-table");
  } catch (err) {
    document.getElementById("commissions-error").textContent = "Error: " + err.message;
    show("commissions-error");
  } finally {
    hide("commissions-loading");
  }
}

// ── Call Review ──
const SCORING_PROMPT = `You are a sales call coach reviewing a closing call for a high-ticket offer ($3,000–$30,000+).

Closer name: {closer}

Transcript:
---
{transcript}
---

Score the closer 1–10 on each category. Be direct and specific — this is for coaching, not flattery.

Categories:
1. Opener & Rapport — Did they build connection quickly and set the right frame?
2. Discovery — Did they uncover real pain, urgency, and budget? Did they listen?
3. Pitch & Bridge — Did they clearly connect the prospect's pain to the offer?
4. Objection Handling — How did they handle pushback? Did they address root causes?
5. Close Attempt — Did they ask for the sale confidently? Did they re-close after objections?
6. Overall — Big picture: was this a good call?

Format EXACTLY as:

## Call Scorecard — {closer}

### Scores
| Category | Score | Summary |
|---|---|---|
| Opener & Rapport | X/10 | ... |
| Discovery | X/10 | ... |
| Pitch & Bridge | X/10 | ... |
| Objection Handling | X/10 | ... |
| Close Attempt | X/10 | ... |
| Overall | X/10 | ... |

**Total: XX/60**

---

### What They Did Well
- (specific moments)

### What to Fix
- (specific problems with quotes where possible)

### Line Rewrites
**What they said:** "..."
**Better version:** "..."
**Why:** one sentence

(repeat for each weak moment)

### Verdict
One paragraph: coaching priority for this rep.`;

async function reviewCall() {
  const closer = document.getElementById("closer-name").value.trim() || "Unknown";
  const transcript = document.getElementById("transcript-input").value.trim();
  const key = localStorage.getItem("cc_anthropic_key");

  if (!transcript) {
    document.getElementById("review-error").textContent = "Paste a transcript first.";
    show("review-error");
    return;
  }

  hide("review-error");
  show("review-loading");
  document.getElementById("review-output").innerHTML = "";

  const prompt = SCORING_PROMPT
    .replace(/{closer}/g, closer)
    .replace("{transcript}", transcript);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    document.getElementById("review-output").innerHTML = markdownToHtml(text);
  } catch (err) {
    document.getElementById("review-error").textContent = "Error: " + err.message;
    show("review-error");
  } finally {
    hide("review-loading");
  }
}

// ── Minimal Markdown Renderer ──
function markdownToHtml(md) {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Tables
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_, header, body) => {
      const ths = header.split("|").filter(s => s.trim()).map(s => `<th>${s.trim()}</th>`).join("");
      const rows = body.trim().split("\n").map(row => {
        const tds = row.split("|").filter(s => s.trim()).map(s => `<td>${s.trim()}</td>`).join("");
        return `<tr>${tds}</tr>`;
      }).join("");
      return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    })
    // Headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // HR
    .replace(/^---$/gm, "<hr>")
    // Bullets
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    // Paragraphs
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[htup])(.+)$/gm, "$1")
    .replace(/^(.+)$/, "<p>$1</p>");
}

// ── Boot ──
init();
