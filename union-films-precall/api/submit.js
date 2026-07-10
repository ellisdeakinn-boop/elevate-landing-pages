// Union Films precall submission endpoint.
// Storage-first: the submission is committed to a private GitHub repo BEFORE
// any delivery attempt, so no email/notification outage can ever lose answers.
// Email (FormSubmit) and Telegram are best-effort delivery on top.

const REPO = "ellisdeakinn-boop/union-films-submissions";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function formatAnswers(answers) {
  return Object.keys(answers)
    .filter((k) => String(answers[k] || "").trim())
    .map((k) => k + ":\n" + answers[k])
    .join("\n\n");
}

async function storeToGitHub(body, subject) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = String(body.answers["Names"] || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const path = `submissions/${ts}-${slug}.json`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "union-films-precall",
    },
    body: JSON.stringify({
      message: subject,
      content: Buffer.from(JSON.stringify(body, null, 2)).toString("base64"),
    }),
  });
  return res.ok;
}

async function relayEmail(body, subject) {
  const payload = { ...body.answers };
  payload["_subject"] = subject;
  payload["_template"] = "box";
  if (body.cc) payload["_cc"] = body.cc;
  const res = await fetch("https://formsubmit.co/ajax/" + body.to, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return false;
  const json = await res.json().catch(() => ({}));
  return json.success === true || json.success === "true";
}

async function notifyTelegram(body, subject) {
  let text = subject + "\n\n" + formatAnswers(body.answers);
  if (text.length > 3800) text = text.slice(0, 3800) + "\n\n[truncated, full copy stored in GitHub]";
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    }
  );
  return res.ok;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const body = req.body || {};
  if (!body.answers || typeof body.answers !== "object" || !body.to) {
    return res.status(400).json({ ok: false, error: "bad payload" });
  }
  if (JSON.stringify(body).length > 60000) {
    return res.status(413).json({ ok: false, error: "too large" });
  }
  const subject = String(body.subject || "Pre-call answers").slice(0, 200);

  const stored = await storeToGitHub(body, subject).catch(() => false);
  const emailed = await relayEmail(body, subject).catch(() => false);
  const notified = await notifyTelegram(body, subject).catch(() => false);

  if (!stored && !emailed && !notified) {
    return res.status(502).json({ ok: false });
  }
  return res.status(200).json({ ok: true, stored, emailed, notified });
};
