/* github-urls.ts — build github.com deep-links from data we already hold.
   PR detail has repo full_name (owner/repo) and PR number — enough to open
   the PR itself in a new tab. (A finding's file:line opens in-app now, in
   the Files changed tab, instead of deep-linking to a GitHub blob.) */

const HOST = "https://github.com";

/** https://github.com/{owner}/{repo}/pull/{number} */
export function githubPrUrl(repoFullName: string, number: number): string {
  return `${HOST}/${repoFullName}/pull/${number}`;
}
