/**
 * The domain/services call `notifier.notify(...)`, never a specific
 * provider's SDK directly — today's implementation is Telegram (see
 * TelegramNotifier); swapping or adding a channel later means adding a
 * new class here, not touching services. See ADR-001.
 */
export interface Notifier {
  notify(message: string): Promise<void>;
}
