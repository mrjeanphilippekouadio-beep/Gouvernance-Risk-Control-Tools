import type { Notifier } from "./Notifier.js";

/**
 * Sends a message to a single fixed chat via the Telegram Bot API
 * (https://core.telegram.org/bots/api#sendmessage). One admin chat for
 * now (Phase A: notifications only) — Phase B/C (blocking questions,
 * remote control) will need a real per-user chat_id mapping instead of
 * this single hardcoded destination.
 */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async notify(message: string): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ chat_id: this.chatId, text: message }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // A failed notification must never break the caller's actual
      // business operation (e.g. recording feedback) — log and move on.
      // eslint-disable-next-line no-console
      console.error(`Telegram notification failed (${res.status}): ${body}`);
    }
  }
}
