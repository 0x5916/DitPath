import type { Locale } from '#lib/locale.ts';
import { NOINDEX_ROUTE_PATHS, ROUTE_PATHS } from './routes.js';

export type SeoMetadata = {
  title: string;
  description: string;
  robots: string;
  ogType: 'website' | 'article';
  ogImagePath: string;
};

export const SITE_NAME = 'DitPath';
export const GITHUB_URL = 'https://github.com/0x5916';
export const DEFAULT_OG_IMAGE_PATH = '/og-image.png';

// Indexable surfaces, derived from the one route list so a route cannot be
// sitemapped without also being prerendered.
const PUBLIC_ROUTE_PATHS = ROUTE_PATHS.filter(
  (routePath) => !NOINDEX_ROUTE_PATHS.includes(routePath)
);

type LocalizedSeoText = {
  title: string;
  description: string;
};

type SeoRouteOverride = {
  robots?: string;
  ogType?: 'website' | 'article';
  ogImagePath?: string;
  localized: Partial<Record<Locale, LocalizedSeoText>>;
};

const DEFAULT_ROBOTS = 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1';
// Routes listed in NOINDEX_ROUTE_PATHS are noindex regardless of their SEO
// entry; a per-route `robots` override still wins if one is ever needed.
const NOINDEX_ROBOTS = 'noindex,nofollow';

const DEFAULT_LOCALIZED_TEXT: Record<Locale, LocalizedSeoText> = {
  en: {
    title: 'DitPath - Morse Code (CW) Training & Practice',
    description:
      "Practice Morse code (CW) with DitPath's free Koch method trainer. Track WPM progress and join the amateur radio community."
  },
  de: {
    title: 'DitPath - Morsecode (CW) Training und Uebung',
    description:
      'Lerne Morsecode (CW) mit dem kostenlosen Koch-Trainer von DitPath. Verfolge deinen WPM-Fortschritt und tausche dich mit der Funk-Community aus.'
  },
  ja: {
    title: 'DitPath - Morse (CW) no Renshuu',
    description:
      'DitPath no muryo Koch methodo toreena de Morse (CW) o renshuu. WPM no seichou o kiroku shi, amateur radio community ni sanka dekimasu.'
  },
  'zh-Hans': {
    title: 'DitPath - Moersi (CW) Xunlian yu Lianxi',
    description:
      'Shi yong DitPath mianfei Koch xunlianqi lianxi Moersi ma(CW), genzong WPM jinbu, bing jiaru wuxian dian shequ.'
  },
  'zh-Hant': {
    title: 'DitPath - Moshi (CW) Xunlian yu Lianxi',
    description:
      'Shi yong DitPath mianfei Koch xunlianqi lianxi Moshi ma(CW), zhuizong WPM jinbu, bing jiaru yuyu diantai shequ.'
  }
};

const ROUTE_SEO: Record<string, SeoRouteOverride> = {
  '/': {
    localized: {
      en: {
        title: 'DitPath - Learn Morse Code at Real Speed',
        description:
          'DitPath is a free Koch-method Morse code trainer: listen at full speed, type what you hear, and watch your accuracy climb. No account needed to start.'
      },
      de: {
        title: 'DitPath - Morsecode in echtem Tempo lernen',
        description:
          'DitPath ist ein kostenloser Morsecode-Trainer nach der Koch-Methode: in vollem Tempo hoeren, Gehoertes tippen und die Genauigkeit steigern. Ohne Konto nutzbar.'
      },
      ja: {
        title: 'DitPath - Jissen Sokudo de Morse o Manabu',
        description:
          'DitPath wa muryo no Koch methodo Morse toreena desu. Jissen sokudo de kiki, kiki totta moji o taipu shi, seido o nobashite ikemasu. Touroku wa fuyo desu.'
      },
      'zh-Hans': {
        title: 'DitPath - Yi Shizhan Sudu Xuexi Mosi Ma',
        description:
          'DitPath shi mianfei de Koch fangfa Mosi ma xunlianqi: yi shizhan sudu tingxie, shuru nitingdao de neirong, buduan tisheng zhunquelu. Wuxu zhanghu.'
      },
      'zh-Hant': {
        title: 'DitPath - Yi Shizhan Sudu Xuexi Moshi Dianma',
        description:
          'DitPath shi mianfei de Koch fangfa Moshi dianma xunlianqi: yi shizhan sudu tingxie, shuru nitingdao de neirong, buduan tisheng zhunquelu. Wuxu zhanghu.'
      }
    }
  },
  '/about': {
    localized: {
      en: {
        title: 'About DitPath - Koch Method, Project and Author',
        description:
          'What DitPath is, how the Koch method teaches Morse code at full speed, who builds it, and how your practice data is handled.'
      },
      de: {
        title: 'Ueber DitPath - Koch-Methode, Projekt und Autor',
        description:
          'Was DitPath ist, wie die Koch-Methode Morsecode in vollem Tempo vermittelt, wer dahintersteht und was mit deinen Uebungsdaten passiert.'
      },
      ja: {
        title: 'DitPath ni tsuite - Koch Methodo to Project',
        description:
          'DitPath no gaiyou, Koch methodo de Morse o manabu shikumi, kaihatsu sha, renshuu data no toriatsukai ni tsuite setsumei shimasu.'
      },
      'zh-Hans': {
        title: 'Guanyu DitPath - Koch Fangfa, Xiangmu yu Zuozhe',
        description:
          'Jieshao DitPath shi shenme, Koch fangfa ruhe jiao shou Mosi ma, zuozhe shi shui, yiji lianxi shuju ruhe chuli.'
      },
      'zh-Hant': {
        title: 'Guanyu DitPath - Koch Fangfa, Zhuanan yu Zuozhe',
        description:
          'Jieshao DitPath shi shenme, Koch fangfa ruhe jiao shou Moshi mima, zuozhe shi shui, yiji lianxi ziliao ruhe chuli.'
      }
    }
  },
  '/morse': {
    localized: {
      en: {
        title: 'Morse Tools - DitPath',
        description:
          'Explore DitPath Morse code tools, starting with a free Koch-method trainer for listening practice and practical CW improvement.'
      },
      de: {
        title: 'Morsewerkzeuge - DitPath',
        description:
          'Entdecke die Morsewerkzeuge von DitPath, beginnend mit einem kostenlosen Koch-Trainer fuer Hoeruebungen und praktische CW-Verbesserung.'
      },
      ja: {
        title: 'Morse Tools - DitPath',
        description:
          'DitPath no Morse tool o shiryou shi, listening practice to jissen-teki na CW no nouryoku o nobasu Koch toreena o hajimemashou.'
      },
      'zh-Hans': {
        title: 'Mosi Ma Gongju - DitPath',
        description:
          'Tan suo DitPath de Mosi ma gongju, cong mianfei Koch xunlianqi kaishi, jinxing tingli lianxi he shizhan CW nengli tisheng.'
      },
      'zh-Hant': {
        title: 'Moshi Ma Gongju - DitPath',
        description:
          'Tan suo DitPath de Moshi ma gongju, cong mianfei Koch xunlianqi kaishi, jinxing tingli lianxi he shizhan CW nengli tisheng.'
      }
    }
  },
  '/morse/learn': {
    localized: {
      en: {
        title: 'Learn Morse Code - DitPath Koch Trainer',
        description:
          'Train Morse code with adaptive Koch lessons, listening drills, and progress tracking built for practical CW improvement.'
      },
      de: {
        title: 'Morse lernen - DitPath Koch-Trainer',
        description:
          'Trainiere Morsecode mit adaptiven Koch-Lektionen, Hoeruebungen und Fortschrittsverfolgung fuer echte CW-Verbesserung.'
      },
      ja: {
        title: 'Morse o Manabu - DitPath Koch Toreena',
        description:
          'Koch lesson, listening drill, shinchoku tsuiseki de jissen-teki ni Morse (CW) no nouryoku o nobasu kunren ga dekimasu.'
      },
      'zh-Hans': {
        title: 'Xuexi Mosi Ma - DitPath Koch Xunlianqi',
        description:
          'Tongguo zishiying Koch kecheng, tingli lianxi he jindu zhuizong, wending tisheng CW shizhan nengli.'
      },
      'zh-Hant': {
        title: 'Xuexi Mosi Ma - DitPath Koch Xunlianqi',
        description:
          'Tongguo zishiying Koch kecheng, tingli lianxi he jindu zhuizong, wending tisheng CW shizhan nengli.'
      }
    }
  },
  '/forum': {
    localized: {
      en: {
        title: 'DitPath Forum - Morse Code & Amateur Radio Community',
        description:
          'Ask questions, share your Morse code progress, and swap CW tips with other amateur radio operators in the DitPath community forum.'
      },
      de: {
        title: 'DitPath Forum - Morsecode-Community und Funkamateure',
        description:
          'Stelle Fragen, teile deinen Fortschritt und tausche Tipps mit anderen Funkamateuren und Morsecode-Lernenden im DitPath-Forum aus.'
      },
      ja: {
        title: 'DitPath Forum - Morse to Musen no Community',
        description:
          'Shitsumon, shinchoku no kyoyu, CW no kotsu no kokan ga dekiru DitPath no community forum desu. Kigaru ni sanka shite, saisho no thread o tatete mimashou.'
      },
      'zh-Hans': {
        title: 'DitPath Luntan - Mosi Ma yu Wuxiandian Shequ',
        description:
          'Zai DitPath shequ luntan tiwen, fenxiang jinbu, yu qita wuxiandian aihaozhe jiaoliu Mosi ma xinde.'
      },
      'zh-Hant': {
        title: 'DitPath Luntan - Moshi Dianma yu Wuxian Shequ',
        description:
          'Zai DitPath shequ luntan tiwen, fenxiang jinbu, yu qita yeyu wuxiandian aihaozhe jiaoliu Moshi dianma xinde.'
      }
    }
  },
  '/more': {
    localized: {
      en: {
        title: 'More - DitPath',
        description: 'App settings, your account, the display mode and the interface language.'
      },
      de: {
        title: 'Mehr - DitPath',
        description: 'App-Einstellungen, dein Konto, das Design und die Sprache der Oberflaeche.'
      },
      ja: {
        title: 'その他 - DitPath',
        description: 'アプリの設定、アカウント、表示テーマ、表示言語。'
      },
      'zh-Hans': {
        title: '更多 - DitPath',
        description: '应用设置、账号、显示主题与界面语言。'
      },
      'zh-Hant': {
        title: '更多 - DitPath',
        description: '應用程式設定、帳號、顯示主題與介面語言。'
      }
    }
  },
  '/login': {
    localized: {
      en: {
        title: 'Login - DitPath',
        description:
          'Sign in to DitPath to continue your Morse code training and sync your learning progress.'
      }
    }
  },
  '/register': {
    localized: {
      en: {
        title: 'Register - DitPath',
        description:
          'Create a DitPath account to save your Morse code training progress and settings.'
      }
    }
  },
  '/profile': {
    localized: {
      en: {
        title: 'Progress - DitPath',
        description: 'Review your DitPath progress and training milestones.'
      }
    }
  },
  '/settings': {
    localized: {
      en: {
        title: 'Settings - DitPath',
        description:
          'Manage your DitPath preferences for language, practice behavior, and account options.'
      }
    }
  }
};

const OG_LOCALE_BY_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  de: 'de_DE',
  ja: 'ja_JP',
  'zh-Hans': 'zh_CN',
  'zh-Hant': 'zh_TW'
};

function getRouteRobots(routeId: string): string {
  const routeSeo = ROUTE_SEO[routeId];
  if (routeSeo?.robots) return routeSeo.robots;
  return NOINDEX_ROUTE_PATHS.includes(routeId) ? NOINDEX_ROBOTS : DEFAULT_ROBOTS;
}

export function isRouteIndexable(routeId: string): boolean {
  return !getRouteRobots(routeId).toLowerCase().includes('noindex');
}

export function getIndexablePublicRoutePaths(): string[] {
  return PUBLIC_ROUTE_PATHS.filter((routePath) => isRouteIndexable(routePath));
}

export function buildLocalizedPath(routePath: string, locale: string): string {
  return normalizePathname(routePath === '/' ? `/${locale}` : `/${locale}${routePath}`);
}

export function buildSitemapUrlSet(origin: string, localeCodes: readonly string[]): string[] {
  const urls = new Set<string>();
  const indexablePublicRoutes = getIndexablePublicRoutePaths();

  // Every locale (including the base locale) publishes an explicit locale
  // prefix, so the bare `/` and `/en` spellings never both appear here.
  for (const locale of localeCodes) {
    for (const routePath of indexablePublicRoutes) {
      urls.add(buildAbsoluteUrl(origin, buildLocalizedPath(routePath, locale)));
    }
  }

  return [...urls].sort();
}

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  if (pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function buildAbsoluteUrl(origin: string, pathname: string): string {
  const normalizedPath = normalizePathname(pathname);
  return new URL(normalizedPath, origin).toString();
}

export function resolveSeoMetadata(
  routeId: string | null | undefined,
  locale: Locale
): SeoMetadata {
  const routeSeo = routeId ? ROUTE_SEO[routeId] : undefined;
  const localizedDefaults = DEFAULT_LOCALIZED_TEXT[locale] ?? DEFAULT_LOCALIZED_TEXT.en;
  const localizedRouteContent = routeSeo?.localized[locale] ?? routeSeo?.localized.en;

  return {
    title: localizedRouteContent?.title ?? localizedDefaults.title,
    description: localizedRouteContent?.description ?? localizedDefaults.description,
    // `getRouteRobots` is the one place that knows which routes are noindex
    // (the route list) — never fall back to the indexable default here.
    robots: getRouteRobots(routeId ?? ''),
    ogType: routeSeo?.ogType ?? 'website',
    ogImagePath: routeSeo?.ogImagePath ?? DEFAULT_OG_IMAGE_PATH
  };
}

export function getOpenGraphLocale(locale: Locale): string {
  return OG_LOCALE_BY_LOCALE[locale] ?? 'en_US';
}
