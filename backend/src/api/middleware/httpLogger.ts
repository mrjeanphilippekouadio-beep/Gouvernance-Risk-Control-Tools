import { pinoHttp } from "pino-http";
import type { DestinationStream } from "pino";

/**
 * Request logger. Credentials must never reach the logs: by default
 * pino-http serializes every request header, which wrote users' bearer
 * tokens in clear text into the Render logs (found 2026-10-08 on staging).
 * `remove: true` drops the keys entirely instead of printing "[Redacted]".
 */
export function httpLogger(stream?: DestinationStream) {
  return pinoHttp(
    {
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        remove: true,
      },
    },
    stream,
  );
}
