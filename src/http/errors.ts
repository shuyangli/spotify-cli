export class SpotifyApiError extends Error {
  override name = "SpotifyApiError";
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    if (status === 404) this.code = "not_found";
    else if (status === 401) this.code = "unauthorized";
    else if (status === 403) this.code = "forbidden";
    else if (status === 429) this.code = "rate_limited";
  }
}
