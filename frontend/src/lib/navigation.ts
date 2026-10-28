/** Navigation sections use SvelteKit route IDs, independent of locale prefixes. */
export function navigationDestination(route: string | null, mobile = false): string | null {
  if (route === '/') return '/';
  if (route === '/morse/learn' || route?.startsWith('/morse/learn/'))
    return mobile ? '/' : '/morse/learn';
  if (route === '/morse/practice' || route === '/morse/progress') return route;
  if (route === '/forum' || route?.startsWith('/forum/')) return mobile ? '/more' : '/forum';
  if (
    route &&
    (['/morse', '/more', '/about', '/settings', '/profile', '/login', '/register'].includes(
      route
    ) ||
      route === '/forum' ||
      route.startsWith('/forum/'))
  )
    return mobile ? '/more' : null;
  return null;
}
