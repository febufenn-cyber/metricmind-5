export class MetricmindError extends Error {
  constructor(code, message, details = undefined, status = 400) {
    super(message);
    this.name = 'MetricmindError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function asPublicError(error) {
  if (error instanceof MetricmindError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details } }
    };
  }

  console.error('Unhandled Metricmind error', error);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }
  };
}
