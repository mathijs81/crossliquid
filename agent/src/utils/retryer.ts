import { logger } from "../logger.js";

class Retryer {
  public maxAttempts: number = 1;
  public timeout: number | null = 10_000;

  public baseDelayMs: number = 1000;
  public maxDelayMs: number = 10000;

  async withRetry<T>(name: string, operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        let promiseCreator: () => Promise<T>;
        const timeout = this.timeout;
        if (timeout) {
          promiseCreator = () => {
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Timeout after ${timeout}ms`));
              }, timeout);
            }) as Promise<T>;
            return Promise.race([operation(), timeoutPromise]);
          };
        } else {
          promiseCreator = operation;
        }
        return await promiseCreator();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const delay = Math.min(
          this.baseDelayMs * 2 ** (attempt - 1),
          this.maxDelayMs,
        );

        if (attempt < this.maxAttempts) {
          logger.warn(
            { name, attempt, delay, error: lastError.message },
            `Operation failed try ${attempt}, retrying`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(
      {
        name,
        attempts: this.maxAttempts,
        error: lastError?.message,
      },
      "Operation failed after all retries",
    );
    throw lastError;
  }
}

export const defaultReadRetryer = new Retryer();
defaultReadRetryer.maxAttempts = 2;
defaultReadRetryer.timeout = 5_000;

export const defaultWriteRetryer = new Retryer();
defaultWriteRetryer.maxAttempts = 3;
defaultWriteRetryer.timeout = 10_000;
