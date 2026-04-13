import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Reports scan progress back to the haxvibe API via HTTP callback.
 * Non-fatal: if the callback fails, the scan continues.
 */
export async function reportProgress(
  callbackUrl: string,
  callbackToken: string,
  scanJobId: string,
  type: 'progress' | 'state' | 'done',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callbackToken}`,
      },
      body: JSON.stringify({ scanJobId, type, payload }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status, scanJobId, type },
        'Progress callback returned non-OK status',
      );
    }
  } catch (err) {
    logger.warn(
      { err, scanJobId, type },
      'Progress callback failed (non-fatal)',
    );
  }
}
