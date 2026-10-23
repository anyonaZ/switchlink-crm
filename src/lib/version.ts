import pkg from "../../package.json";

/**
 * The one release number, from package.json, plus the git commit the build was
 * made from (GIT_COMMIT, passed in by scripts/release.sh / the Docker build).
 * Shown in More → About and returned by /api/health, so support can tell
 * exactly which build is running.
 */
export const VERSION: string = pkg.version;
export const COMMIT: string = (process.env.GIT_COMMIT || "").slice(0, 12) || "dev";
export const RELEASE = `${VERSION} (${COMMIT})`;
