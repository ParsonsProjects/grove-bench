/** Wording for the Preview tab. */

/** A plain explanation for a failed page load, from Chromium's error code. */
export function loadErrorHint(error: { code: number; description: string }): string {
  switch (error.description) {
    case 'ERR_CONNECTION_REFUSED':
      return 'Nothing is listening on that port. Is the dev server running?';
    case 'ERR_NAME_NOT_RESOLVED':
      return "That address couldn't be found. Check the host name.";
    case 'ERR_CONNECTION_RESET':
    case 'ERR_EMPTY_RESPONSE':
      return 'The server closed the connection. It may still be starting, or it crashed.';
    case 'ERR_INTERNET_DISCONNECTED':
      return "You're offline.";
    case 'ERR_CERT_AUTHORITY_INVALID':
    case 'ERR_CERT_COMMON_NAME_INVALID':
    case 'ERR_CERT_DATE_INVALID':
      return "The site's certificate isn't trusted.";
    case 'ERR_FILE_NOT_FOUND':
      return "That file doesn't exist.";
    case 'ERR_UNSAFE_PORT':
      return 'Browsers block that port. Use a different one.';
    case 'ERR_BLOCKED_BY_CLIENT':
    case 'ERR_FAILED':
      return 'The page was blocked or failed to load.';
    default:
      return `${error.description || 'Unknown error'} (${error.code})`;
  }
}
