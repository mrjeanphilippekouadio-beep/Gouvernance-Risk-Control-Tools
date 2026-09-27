import type { Notifier } from "./Notifier.js";

/** Used when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID aren't configured — notifications are optional. */
export class NoopNotifier implements Notifier {
  async notify(): Promise<void> {
    // intentionally does nothing
  }
}
