import { describe, expect, it } from 'vitest';
import { navigationDestination } from './navigation';

describe('navigation destinations', () => {
  it.each(['/morse/practice', '/morse/progress', '/'])('keeps %s directly reachable', (route) => {
    expect(navigationDestination(route)).toBe(route);
    expect(navigationDestination(route, true)).toBe(route);
  });
  it.each(['/morse/learn', '/morse/learn/session'])('groups %s under mobile Home', (route) => {
    expect(navigationDestination(route)).toBe('/morse/learn');
    expect(navigationDestination(route, true)).toBe('/');
  });
  it.each(['/morse', '/more', '/settings', '/profile', '/login', '/register', '/about'])(
    'keeps secondary destination %s under More',
    (route) => {
      expect(navigationDestination(route)).toBeNull();
      expect(navigationDestination(route, true)).toBe('/more');
    }
  );
  it.each(['/forum', '/forum/[id]'])('exposes %s directly on desktop', (route) => {
    expect(navigationDestination(route)).toBe('/forum');
    expect(navigationDestination(route, true)).toBe('/more');
  });
  it('does not invent a current destination for missing routes', () => {
    expect(navigationDestination(null)).toBeNull();
    expect(navigationDestination('/unknown')).toBeNull();
  });
});
