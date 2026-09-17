/**
 * Which build this is, as the user would read it out.
 *
 * Shared because more than one thing says it and they must agree: the
 * indicator in the menu, and the build recorded against a piece of feedback. A
 * report that says "86" while the screen says "v86" is one more thing to work
 * out at the moment somebody is already confused.
 *
 * A count renders as a version; anything else — a git-less build from a
 * tarball — is shown as-is, so it cannot be mistaken for one. A wrong version
 * is worse than an obviously missing one when the whole point is reading it
 * out when something looks wrong.
 */
export const buildLabel = (buildId: string): string =>
  /^\d+$/.test(buildId) ? `v${buildId}` : buildId
