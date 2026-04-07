export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export interface ErrorEnvelope {
  error: {
    message: string;
    code?: string;
    status?: number;
    details?: unknown;
  };
}

export function printError(err: unknown): void {
  const envelope = toErrorEnvelope(err);
  process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
}

export function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof Error) {
    const anyErr = err as Error & {
      code?: string;
      status?: number;
      details?: unknown;
    };
    return {
      error: {
        message: err.message,
        ...(anyErr.code !== undefined ? { code: anyErr.code } : {}),
        ...(anyErr.status !== undefined ? { status: anyErr.status } : {}),
        ...(anyErr.details !== undefined ? { details: anyErr.details } : {}),
      },
    };
  }
  return { error: { message: String(err) } };
}
