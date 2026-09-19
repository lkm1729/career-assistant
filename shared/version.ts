// Public Windows release may include a fourth build component; package version stays SemVer.
// Single source for all current-version UI labels; historical record versions are untouched.
import metadata from '../package.json' with { type: 'json' };
export const appVersion = metadata.build.buildVersion ?? metadata.version;
