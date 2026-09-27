import "dotenv/config";
import { pool } from "../infrastructure/database/pool.js";

/**
 * Phase B (text only — voice notes are Phase B2): an autonomous agent
 * session calls this to ask the Product Owner a blocking question. It
 * records a PENDING row and sends the question over Telegram, then
 * exits immediately — the caller is expected to re-check later via
 * telegramPoll.ts (e.g. from a /loop session's ScheduleWakeup), not to
 * block waiting here.
 *
 * Usage: tsx src/scripts/telegramAsk.ts "<question text>"
 * Prints: {"questionId": "<uuid>"}
 */
async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: tsx src/scripts/telegramAsk.ts "<question>"');
    process.exit(1);
  }

  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
    process.exit(1);
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agent_questions (question) VALUES ($1) RETURNING id`,
    [question],
  );
  const questionId = rows[0]?.id;
  if (!questionId) throw new Error("Insert into agent_questions returned no row");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ chat_id: chatId, text: `❓ ${question}` }),
  });
  if (!res.ok) {
    console.error(`Telegram sendMessage failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }

  console.log(JSON.stringify({ questionId }));
  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
