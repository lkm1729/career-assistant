/** A release must never trust an environment-selected development server. */
export function rendererLocation(
  packaged: boolean,
  devUrl: string | undefined,
  bundledUrl: string,
) {
  return !packaged && devUrl === 'http://127.0.0.1:5173' ? devUrl : bundledUrl;
}
export const releaseDebugSwitches = ['remote-debugging-port', 'remote-debugging-pipe'] as const;
