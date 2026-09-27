import "dotenv/config";
import { pool } from "../infrastructure/database/pool.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    voice?: unknown;
    chat: { id: number };
  };
}

async function getState(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(`SELECT value FROM agent_bot_state WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

async function setState(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO agent_bot_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

/**
 * Checks whether the Product Owner has answered a question asked via
 * telegramAsk.ts. Meant to be re-run periodically (e.g. by a /loop
 * session's ScheduleWakeup) until it reports ANSWERED — each run is a
 * single non-blocking check, never a long poll.
 *
 * Voice notes aren't transcribed yet (Phase B2) — if one arrives while
 * waiting, this replies on Telegram asking for text instead, and keeps
 * looking at the other buffered updates for a text answer.
 *
 * Usage: tsx src/scripts/telegramPoll.ts <questionId>
 * Prints: {"status":"PENDING"} or {"status":"ANSWERED","answer":"..."}
 */
async function main(): Promise<void> {
  const questionId = process.argv[2];
  if (!questionId) {
    console.error("Usage: tsx src/scripts/telegramPoll.ts <questionId>");
    process.exit(1);
  }

  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
    process.exit(1);
  }

  const { rows: qRows } = await pool.query<{ status: string; answer: string | null }>(
    `SELECT status, answer FROM agent_questions WHERE id = $1`,
    [questionId],
  );
  const existing = qRows[0];
  if (!existing) {
    console.error(`No question with id ${questionId}`);
    process.exit(1);
  }
  if (existing.status === "ANSWERED") {
    console.log(JSON.stringify({ status: "ANSWERED", answer: existing.answer }));
    await pool.end();
    return;
  }

  const storedOffset = await getState("telegram_last_update_id");

  // First run ever: anything already sitting in Telegram's unconfirmed
  // queue (e.g. messages sent before this loop existed) is backlog, not
  // a fresh answer to *this* question — peek at it to find the baseline
  // and consume it without treating any of it as an answer.
  if (storedOffset === null) {
    const peek = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=0`);
    const peekData = (await peek.json()) as { ok: boolean; result?: TelegramUpdate[] };
    const maxSeen = (peekData.result ?? []).reduce((max, u) => Math.max(max, u.update_id), 0);
    await setState("telegram_last_update_id", String(maxSeen));
    console.log(JSON.stringify({ status: "PENDING" }));
    await pool.end();
    return;
  }

  const lastUpdateId = Number(storedOffset);
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`);
  const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
  if (!data.ok || !data.result) {
    console.error(`Telegram getUpdates failed: ${data.description ?? JSON.stringify(data)}`);
    process.exit(1);
  }

  let answer: string | null = null;
  let maxUpdateId = lastUpdateId;

  for (const update of data.result) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    const msg = update.message;
    if (!msg || String(msg.chat.id) !== chatId) continue;

    if (msg.text && !answer) {
      answer = msg.text;
    } else if (msg.voice) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "Les notes vocales ne sont pas encore supportées — réponds en texte pour l'instant (Phase B2 à venir).",
        }),
      });
    }
  }

  if (maxUpdateId > lastUpdateId) {
    await setState("telegram_last_update_id", String(maxUpdateId));
  }

  if (answer) {
    await pool.query(
      `UPDATE agent_questions SET status = 'ANSWERED', answer = $2, answered_at = now() WHERE id = $1`,
      [questionId, answer],
    );
    console.log(JSON.stringify({ status: "ANSWERED", answer }));
  } else {
    console.log(JSON.stringify({ status: "PENDING" }));
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
