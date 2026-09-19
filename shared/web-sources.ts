/** Explicit, fixed public-data adapter. Never use a host or API endpoint from remote HTML. */
export function publicJobEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://cityu.app.kinobi.asia' || url.username || url.password) return null;
    const match = /^\/(?:en\/|zh\/|yue\/)?jobs\/([a-zA-Z0-9-]{1,400})\/?$/.exec(url.pathname);
    return match ? `https://cityu.server.kinobi.asia/api/job/${match[1]}/public` : null;
  } catch {
    return null;
  }
}
