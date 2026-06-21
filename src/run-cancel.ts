export class RunCancelledError extends Error {
  constructor(message = 'Run cancelled.') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RunCancelledError();
  }
}
