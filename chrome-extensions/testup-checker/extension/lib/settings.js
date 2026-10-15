/*
 * テストアップチェッカー：設定と環境（本番 / テスト環境）の判定
 */
(function (root) {
  'use strict';
  const TUC = (root.TUC = root.TUC || {});

  const DEFAULTS = {
    productionHosts: [],
    stagingHosts: [],
    autoCheck: 'registered', // off | registered | all
    showToast: true,
    fuzzyThreshold: 60,
  };

  const ENV_LABELS = {
    production: '本番',
    staging: 'テスト環境',
    unknown: '未登録',
    unsupported: '対象外',
  };

  // 初期ドメイン・プレビュー用に使われやすいホスティング（本番の可能性もあるので「弱い」判定）
  const WEAK_SUFFIXES = [
    'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com',
    'amplifyapp.com', 'onrender.com', 'github.io', 'glitch.me', 'repl.co', 'stackblitz.io', 'csb.app',
    'azurewebsites.net', 'cloudfront.net', 's3.amazonaws.com', 'wpengine.com', 'wpenginepowered.com', 'kinsta.cloud',
    'xsrv.jp', 'sakura.ne.jp', 'lolipop.jp', 'heteml.net', 'wpx.jp', 'conohawing.com',
  ];
  const STRONG_SUFFIXES = [
    'localhost', 'local', 'test', 'example', 'invalid', 'internal', 'ngrok.io', 'ngrok-free.app', 'ngrok.app',
    'loca.lt', 'trycloudflare.com',
  ];
  const SECOND_LEVEL = new Set(['co', 'ne', 'or', 'ac', 'go', 'gr', 'ed', 'lg', 'ad', 'com', 'net', 'org', 'gov', 'edu']);
  const STRONG_LABEL_RE =
    /^(?:stg|staging|dev|develop|development|test|testing|tst|uat|qa|sandbox|local|tmp|temp)(?:\d+|[-_].*)?$|[-_](?:stg|staging|dev|test|testing|uat|qa|tmp)\d*$/;
  const WEAK_LABEL_RE = /^(?:stage|demo|preview|draft)(?:\d+|[-_].*)?$|[-_](?:stage|demo|preview)\d*$/;
  const PRIVATE_IP_RE = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$)/;

  function normalizeHostPattern(p) {
    p = String(p || '').trim().toLowerCase();
    if (!p) return '';
    p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '');
    const wild = p.startsWith('*.');
    const body = wild ? p.slice(2) : p;
    try {
      // 日本語ドメインは punycode に、ポート付きはそのまま
      const u = new URL(`http://${body}/`);
      return (wild ? '*.' : '') + (body.includes(':') ? u.host : u.hostname);
    } catch (e) {
      return '';
    }
  }

  function parseHostList(value) {
    const tokens = Array.isArray(value)
      ? value
      : String(value || '')
          .split(/\r?\n/)
          .map((line) => line.replace(/#.*$/, ''))
          .join(' ')
          .split(/[,、\s]+/);
    return [...new Set(tokens.map(normalizeHostPattern).filter(Boolean))];
  }

  function hostMatches(u, pattern) {
    const target = pattern.includes(':') ? u.host : u.hostname;
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return target === base || target.endsWith('.' + base);
    }
    return target === pattern || target === 'www.' + pattern;
  }

  function toURL(url) {
    try {
      return url instanceof URL ? url : new URL(url);
    } catch (e) {
      return null;
    }
  }

  function matchesAny(url, patterns) {
    const u = toURL(url);
    if (!u) return false;
    return parseHostList(patterns).some((p) => hostMatches(u, p));
  }

  /** 0: 該当なし / 1: テスト環境っぽい（弱） / 2: テスト環境・ローカル（強） */
  function stagingLevel(hostname, settings, port) {
    hostname = String(hostname || '').toLowerCase().replace(/\.$/, '');
    if (!hostname) return 0;
    if (settings && settings.stagingHosts && settings.stagingHosts.length) {
      const u = toURL(`http://${hostname}${port ? ':' + port : ''}/`);
      if (u && parseHostList(settings.stagingHosts).some((p) => hostMatches(u, p))) return 2;
    }
    if (hostname === 'localhost' || PRIVATE_IP_RE.test(hostname)) return 2;
    if (STRONG_SUFFIXES.some((s) => hostname === s || hostname.endsWith('.' + s))) return 2;
    const labels = hostname.split('.');
    let keep = 2;
    if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2])) keep = 3;
    const sub = labels.slice(0, Math.max(0, labels.length - keep));
    if (sub.some((l) => STRONG_LABEL_RE.test(l))) return 2;
    if (sub.some((l) => WEAK_LABEL_RE.test(l))) return 1;
    if (WEAK_SUFFIXES.some((s) => hostname.endsWith('.' + s))) return 1;
    return 0;
  }

  function isExampleHost(hostname) {
    hostname = String(hostname || '').toLowerCase();
    return /(?:^|\.)example\.(?:com|net|org|jp|co\.jp|ne\.jp)$/.test(hostname) || /\.example$/.test(hostname);
  }

  /** @returns {{env: 'production'|'staging'|'unknown'|'unsupported', source: 'settings'|'guess'|'none'}} */
  function detectEnv(url, settings) {
    const u = toURL(url);
    if (!u || !/^https?:$/.test(u.protocol)) return { env: 'unsupported', source: 'none' };
    settings = settings || DEFAULTS;
    if (matchesAny(u, settings.productionHosts)) return { env: 'production', source: 'settings' };
    if (matchesAny(u, settings.stagingHosts)) return { env: 'staging', source: 'settings' };
    if (stagingLevel(u.hostname, null) >= 2) return { env: 'staging', source: 'guess' };
    return { env: 'unknown', source: 'none' };
  }

  async function load() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    return Object.assign({}, DEFAULTS, stored);
  }

  async function save(patch) {
    await chrome.storage.sync.set(patch);
  }

  TUC.settings = {
    DEFAULTS,
    ENV_LABELS,
    parseHostList,
    hostMatches,
    matchesAny,
    stagingLevel,
    isExampleHost,
    detectEnv,
    load,
    save,
  };
  if (typeof module === 'object' && module.exports) module.exports = TUC.settings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
