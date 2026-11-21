/** Turn an npm HTTPS repository URL into the browser link shown in settings. */
export function repositorySourceUrl(url: string): string {
  return url.replace(/^git\+/u, '').replace(/\.git$/u, '');
}
