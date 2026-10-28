import type { Locale } from '#lib/locale.ts';
import { localizedRoutePath, NOINDEX_ROUTE_PATHS, ROUTE_PATHS } from './routes.js';

export type SeoMetadata = {
  title: string;
  description: string;
  robots: string;
  ogType: 'website' | 'article';
  ogImagePath: string;
};

export const SITE_NAME = 'OpenCW';
export const GITHUB_URL = 'https://github.com/0x5916/Morse';
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
    title: 'OpenCW - Morse Code (CW) Training & Practice',
    description:
      "Practice Morse code (CW) with OpenCW's free Koch method trainer. Track WPM progress and join the amateur radio community."
  },
  de: {
    title: 'OpenCW - Morsecode (CW) Training und Uebung',
    description:
      'Lerne Morsecode (CW) mit dem kostenlosen Koch-Trainer von OpenCW. Verfolge deinen WPM-Fortschritt und tausche dich mit der Funk-Community aus.'
  },
  ja: {
    title: 'OpenCW - Morse (CW) no Renshuu',
    description:
      'OpenCW no muryo Koch methodo toreena de Morse (CW) o renshuu. WPM no seichou o kiroku shi, amateur radio community ni sanka dekimasu.'
  },
  'zh-Hans': {
    title: 'OpenCW - Moersi (CW) Xunlian yu Lianxi',
    description:
      'Shi yong OpenCW mianfei Koch xunlianqi lianxi Moersi ma(CW), genzong WPM jinbu, bing jiaru wuxian dian shequ.'
  },
  'zh-Hant': {
    title: 'OpenCW - Moshi (CW) Xunlian yu Lianxi',
    description:
      'Shi yong OpenCW mianfei Koch xunlianqi lianxi Moshi ma(CW), zhuizong WPM jinbu, bing jiaru yuyu diantai shequ.'
  }
};

const ROUTE_SEO: Record<string, SeoRouteOverride> = {
  '/': {
    localized: {
      en: {
        title: 'OpenCW - Learn Morse Code at Real Speed',
        description:
          'OpenCW is a free Koch-method Morse code trainer: listen at full speed, type what you hear, and watch your accuracy climb. No account needed to start.'
      },
      de: {
        title: 'OpenCW - Morsecode in echtem Tempo lernen',
        description:
          'OpenCW ist ein kostenloser Morsecode-Trainer nach der Koch-Methode: in vollem Tempo hoeren, Gehoertes tippen und die Genauigkeit steigern. Ohne Konto nutzbar.'
      },
      ja: {
        title: 'OpenCW - Jissen Sokudo de Morse o Manabu',
        description:
          'OpenCW wa muryo no Koch methodo Morse toreena desu. Jissen sokudo de kiki, kiki totta moji o taipu shi, seido o nobashite ikemasu. Touroku wa fuyo desu.'
      },
      'zh-Hans': {
        title: 'OpenCW - Yi Shizhan Sudu Xuexi Mosi Ma',
        description:
          'OpenCW shi mianfei de Koch fangfa Mosi ma xunlianqi: yi shizhan sudu tingxie, shuru nitingdao de neirong, buduan tisheng zhunquelu. Wuxu zhanghu.'
      },
      'zh-Hant': {
        title: 'OpenCW - Yi Shizhan Sudu Xuexi Moshi Dianma',
        description:
          'OpenCW shi mianfei de Koch fangfa Moshi dianma xunlianqi: yi shizhan sudu tingxie, shuru nitingdao de neirong, buduan tisheng zhunquelu. Wuxu zhanghu.'
      }
    }
  },
  '/about': {
    localized: {
      en: {
        title: 'About OpenCW - Koch Method, Project and Author',
        description:
          'What OpenCW is, how the Koch method teaches Morse code at full speed, who builds it, and how your practice data is handled.'
      },
      de: {
        title: 'Ueber OpenCW - Koch-Methode, Projekt und Autor',
        description:
          'Was OpenCW ist, wie die Koch-Methode Morsecode in vollem Tempo vermittelt, wer dahintersteht und was mit deinen Uebungsdaten passiert.'
      },
      ja: {
        title: 'OpenCW ni tsuite - Koch Methodo to Project',
        description:
          'OpenCW no gaiyou, Koch methodo de Morse o manabu shikumi, kaihatsu sha, renshuu data no toriatsukai ni tsuite setsumei shimasu.'
      },
      'zh-Hans': {
        title: 'Guanyu OpenCW - Koch Fangfa, Xiangmu yu Zuozhe',
        description:
          'Jieshao OpenCW shi shenme, Koch fangfa ruhe jiao shou Mosi ma, zuozhe shi shui, yiji lianxi shuju ruhe chuli.'
      },
      'zh-Hant': {
        title: 'Guanyu OpenCW - Koch Fangfa, Zhuanan yu Zuozhe',
        description:
          'Jieshao OpenCW shi shenme, Koch fangfa ruhe jiao shou Moshi mima, zuozhe shi shui, yiji lianxi ziliao ruhe chuli.'
      }
    }
  },
  '/morse': {
    localized: {
      en: {
        title: 'Reference | OpenCW Morse Characters',
        description:
          'Look up every OpenCW course character, inspect its Morse code pattern, and listen to its sound in an unscored character reference.'
      },
      de: {
        title: 'Referenz | OpenCW Morsezeichen',
        description:
          'Schlage jedes Zeichen im OpenCW-Kurs nach, sieh dir sein Morsezeichen an und höre seinen Klang in einer Zeichenreferenz ohne Bewertung.'
      },
      ja: {
        title: 'リファレンス | OpenCW モールス符号一覧',
        description:
          'OpenCWのコースに登場するすべての文字・数字・記号を調べ、モールス符号の表記と音を確認できます。何度でも再生でき、採点はありません。文章の聞き取り練習やガイド付きレッスンにも進めます。'
      },
      'zh-Hans': {
        title: '参考 | OpenCW 摩尔斯电码字符与声音',
        description:
          '查询 OpenCW 课程中的所有字母、数字和标点符号，查看每个字符的摩尔斯电码符号并反复聆听声音。此字符参考工具不计分，也不会改变课程进度。准备好后可打开短文听抄练习，或返回引导课程继续学习。'
      },
      'zh-Hant': {
        title: '參考 | OpenCW 摩斯電碼字元與聲音',
        description:
          '查詢 OpenCW 課程中的所有字母、數字和標點符號，查看每個字元的摩斯電碼符號並反覆聆聽聲音。此字元參考工具不計分，也不會改變課程進度。準備好後可開啟短文聽抄練習，或返回引導課程繼續學習。'
      }
    }
  },
  '/morse/learn': {
    localized: {
      en: {
        title: 'Lessons | OpenCW Morse Code Course',
        description:
          'Train Morse code with adaptive Koch lessons, listening drills, and progress tracking built for practical CW improvement.'
      },
      de: {
        title: 'Lektionen | OpenCW Morsecode-Kurs',
        description:
          'Trainiere Morsecode mit adaptiven Koch-Lektionen, Hoeruebungen und Fortschrittsverfolgung fuer echte CW-Verbesserung.'
      },
      ja: {
        title: 'レッスン | OpenCW モールス符号コース',
        description:
          'Koch lesson, listening drill, shinchoku tsuiseki de jissen-teki ni Morse (CW) no nouryoku o nobasu kunren ga dekimasu.'
      },
      'zh-Hans': {
        title: '课程 | OpenCW 摩尔斯电码声音识别课程',
        description:
          'Tongguo zishiying Koch kecheng, tingli lianxi he jindu zhuizong, wending tisheng CW shizhan nengli.'
      },
      'zh-Hant': {
        title: '課程 | OpenCW 摩斯電碼聲音辨識課程',
        description:
          'Tongguo zishiying Koch kecheng, tingli lianxi he jindu zhuizong, wending tisheng CW shizhan nengli.'
      }
    }
  },
  '/morse/practice': {
    localized: {
      en: {
        title: 'Practice | OpenCW Morse Copying',
        description:
          'Choose a character set, listen to a Morse passage, and check your transcription in self-directed Practice. Guided lesson progress stays separate.'
      },
      de: {
        title: 'Übungen | OpenCW Morse-Mitschreiben',
        description:
          'Wähle einen Zeichensatz, höre einen Morsetext und prüfe deine Mitschrift in den freien Übungen. Der Fortschritt in den Lektionen bleibt davon getrennt.'
      },
      ja: {
        title: '練習 | OpenCW モールス符号の書き取り',
        description:
          '文字セットを選び、モールス符号の文章を聞いて書き取り、内容を確認できます。自由な練習によってレッスンの進捗が変わることはありません。'
      },
      'zh-Hans': {
        title: '练习 | OpenCW 摩尔斯电码听抄练习',
        description:
          '选择字符集，聆听一段摩尔斯电码并核对抄收内容。自由练习不会影响课程的解锁或掌握条件。'
      },
      'zh-Hant': {
        title: '練習 | OpenCW 摩斯電碼聽抄練習',
        description:
          '選擇字元集，聆聽一段摩斯電碼並核對抄收內容。自由練習不會影響課程的解鎖或掌握條件。'
      }
    }
  },
  '/forum': {
    localized: {
      en: {
        title: 'OpenCW Forum - Morse Code & Amateur Radio Community',
        description:
          'Ask questions, share your Morse code progress, and swap CW tips with other amateur radio operators in the OpenCW community forum.'
      },
      de: {
        title: 'OpenCW Forum - Morsecode-Community und Funkamateure',
        description:
          'Stelle Fragen, teile deinen Fortschritt und tausche Tipps mit anderen Funkamateuren und Morsecode-Lernenden im OpenCW-Forum aus.'
      },
      ja: {
        title: 'OpenCW Forum - Morse to Musen no Community',
        description:
          'Shitsumon, shinchoku no kyoyu, CW no kotsu no kokan ga dekiru OpenCW no community forum desu. Kigaru ni sanka shite, saisho no thread o tatete mimashou.'
      },
      'zh-Hans': {
        title: 'OpenCW Luntan - Mosi Ma yu Wuxiandian Shequ',
        description:
          'Zai OpenCW shequ luntan tiwen, fenxiang jinbu, yu qita wuxiandian aihaozhe jiaoliu Mosi ma xinde.'
      },
      'zh-Hant': {
        title: 'OpenCW Luntan - Moshi Dianma yu Wuxian Shequ',
        description:
          'Zai OpenCW shequ luntan tiwen, fenxiang jinbu, yu qita yeyu wuxiandian aihaozhe jiaoliu Moshi dianma xinde.'
      }
    }
  },
  '/more': {
    localized: {
      en: {
        title: 'More - OpenCW',
        description: 'App settings, your account, the display mode and the interface language.'
      },
      de: {
        title: 'Mehr - OpenCW',
        description: 'App-Einstellungen, dein Konto, das Design und die Sprache der Oberflaeche.'
      },
      ja: {
        title: 'その他 - OpenCW',
        description: 'アプリの設定、アカウント、表示テーマ、表示言語。'
      },
      'zh-Hans': {
        title: '更多 - OpenCW',
        description: '应用设置、账号、显示主题与界面语言。'
      },
      'zh-Hant': {
        title: '更多 - OpenCW',
        description: '應用程式設定、帳號、顯示主題與介面語言。'
      }
    }
  },
  '/login': {
    localized: {
      en: {
        title: 'Login - OpenCW',
        description:
          'Sign in to OpenCW to continue your Morse code training and sync your learning progress.'
      }
    }
  },
  '/register': {
    localized: {
      en: {
        title: 'Register - OpenCW',
        description:
          'Create a OpenCW account to save your Morse code training progress and settings.'
      }
    }
  },
  '/profile': {
    localized: {
      en: {
        title: 'Progress - OpenCW',
        description: 'Review your OpenCW progress and training milestones.'
      }
    }
  },
  '/settings': {
    localized: {
      en: {
        title: 'Settings - OpenCW',
        description:
          'Manage your OpenCW preferences for language, practice behavior, and account options.'
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
  return normalizePathname(localizedRoutePath(routePath, locale));
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
