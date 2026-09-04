import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SITE_URL =
  process.env.SITE_URL ||
  "https://kirsehirmanset.com/";

const MAX_URLS =
  Number(process.env.MAX_URLS || 10);

const TARGET_FEED_URL =
  process.env.TARGET_FEED_URL ||
  "";

const TARGET_FEED_KEY =
  process.env.TARGET_FEED_KEY ||
  "";

const DATA_DIR =
  path.resolve("data");

const REPORT_DIR =
  path.join(
    DATA_DIR,
    "reports"
  );

await fs.mkdir(
  REPORT_DIR,
  {
    recursive: true
  }
);


/* =========================================================
   GENEL
   ========================================================= */

function cleanUrl(url) {
  return String(
    url || ""
  )
    .trim()
    .replace(
      /#.*$/,
      ""
    );
}


function normalizeUrl(url) {
  try {
    const u =
      new URL(
        cleanUrl(url)
      );

    u.hash = "";

    /*
     * AMP sayfalarını Lighthouse'a göndermiyoruz.
     */
    if (
      u.pathname
        .toLowerCase()
        .startsWith("/amp/")
    ) {
      u.pathname =
        u.pathname.replace(
          /^\/amp\//i,
          "/"
        );
    }

    /*
     * Son slash standardizasyonu.
     */
    if (
      u.pathname.length > 1
    ) {
      u.pathname =
        u.pathname.replace(
          /\/+$/,
          ""
        );
    }

    return u.toString();
  } catch {
    return "";
  }
}


function sameHost(a, b) {
  try {
    const hostA =
      new URL(a)
        .hostname
        .replace(
          /^www\./,
          ""
        )
        .toLowerCase();

    const hostB =
      new URL(b)
        .hostname
        .replace(
          /^www\./,
          ""
        )
        .toLowerCase();

    return hostA === hostB;
  } catch {
    return false;
  }
}


function isAmpUrl(url) {
  try {
    return new URL(url)
      .pathname
      .toLowerCase()
      .startsWith("/amp/");
  } catch {
    return false;
  }
}


/* =========================================================
   HTTP KONTROL
   ========================================================= */

async function checkUrl(url) {
  try {
    const response =
      await fetch(
        url,
        {
          method: "HEAD",
          redirect: "follow",
          headers: {
            "user-agent":
              "KirsehirManset-Lighthouse/6.0"
          }
        }
      );

    return {
      ok:
        response.status >= 200 &&
        response.status < 400,

      status:
        response.status,

      finalUrl:
        response.url ||
        url
    };
  } catch {
    /*
     * Bazı sunucular HEAD desteklemez.
     * Bu durumda GET ile ikinci kontrol.
     */
    try {
      const response =
        await fetch(
          url,
          {
            method: "GET",
            redirect: "follow",
            headers: {
              "user-agent":
                "KirsehirManset-Lighthouse/6.0"
            }
          }
        );

      return {
        ok:
          response.status >= 200 &&
          response.status < 400,

        status:
          response.status,

        finalUrl:
          response.url ||
          url
      };
    } catch {
      return {
        ok: false,
        status: 0,
        finalUrl: url
      };
    }
  }
}


/* =========================================================
   APPS SCRIPT FEED
   ========================================================= */

async function getTargetUrls() {
  if (
    !TARGET_FEED_URL ||
    !TARGET_FEED_KEY
  ) {
    throw new Error(
      "TARGET_FEED_URL veya TARGET_FEED_KEY eksik."
    );
  }

  const separator =
    TARGET_FEED_URL.includes("?")
      ? "&"
      : "?";

  const feedUrl =
    TARGET_FEED_URL +
    separator +
    "key=" +
    encodeURIComponent(
      TARGET_FEED_KEY
    );

  console.log(
    "Search Console hedef feed okunuyor..."
  );

  const response =
    await fetch(
      feedUrl,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent":
            "KirsehirManset-Lighthouse/6.0",
          "accept":
            "application/json"
        }
      }
    );

  const text =
    await response.text();

  console.log(
    "Feed HTTP:",
    response.status
  );

  if (
    !response.ok
  ) {
    throw new Error(
      "Target feed HTTP " +
        response.status
    );
  }

  let data;

  try {
    data =
      JSON.parse(
        text
      );
  } catch {
    throw new Error(
      "Target feed JSON döndürmedi."
    );
  }

  if (
    data.error
  ) {
    throw new Error(
      "Target feed error: " +
        JSON.stringify(
          data.error
        )
    );
  }

  const rawUrls =
    Array.isArray(
      data.urls
    )
      ? data.urls
      : [];

  console.log(
    "Feed URL sayısı:",
    rawUrls.length
  );

  return rawUrls;
}


/* =========================================================
   GEÇERLİ URL SEÇİMİ
   ========================================================= */

async function buildValidTargetList(
  rawUrls
) {
  const candidates = [];

  /*
   * Ana sayfa her zaman ilk aday.
   */
  candidates.push(
    normalizeUrl(
      SITE_URL
    )
  );

  for (
    const rawUrl of
    rawUrls
  ) {
    const normalized =
      normalizeUrl(
        rawUrl
      );

    if (
      !normalized
    ) {
      continue;
    }

    if (
      !sameHost(
        normalized,
        SITE_URL
      )
    ) {
      continue;
    }

    /*
     * AMP'yi atla.
     */
    if (
      isAmpUrl(
        rawUrl
      )
    ) {
      continue;
    }

    candidates.push(
      normalized
    );
  }

  const unique =
    [
      ...new Set(
        candidates
      )
    ];

  console.log(
    "URL doğrulama başlıyor..."
  );

  const valid = [];

  for (
    const url of
    unique
  ) {
    if (
      valid.length >=
      MAX_URLS
    ) {
      break;
    }

    const check =
      await checkUrl(
        url
      );

    console.log(
      check.status,
      url
    );

    if (
      check.ok
    ) {
      const finalUrl =
        normalizeUrl(
          check.finalUrl ||
            url
        );

      if (
        finalUrl &&
        sameHost(
          finalUrl,
          SITE_URL
        )
      ) {
        valid.push(
          finalUrl
        );
      }
    } else {
      console.log(
        "ATLANDI:",
        url
      );
    }
  }

  return [
    ...new Set(
      valid
    )
  ].slice(
    0,
    MAX_URLS
  );
}


/* =========================================================
   LIGHTHOUSE
   ========================================================= */

function runLighthouse(
  url,
  mode,
  outputPath
) {
  const args = [
    url,

    "--quiet",

    "--output=json",

    `--output-path=${outputPath}`,

    "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage",

    "--only-categories=performance,accessibility,best-practices,seo"
  ];

  if (
    mode ===
    "desktop"
  ) {
    args.push(
      "--preset=desktop"
    );
  }

  execFileSync(
    process.platform ===
      "win32"
      ? "npx.cmd"
      : "npx",

    [
      "lighthouse@13.4.1",
      ...args
    ],

    {
      stdio:
        "inherit"
    }
  );
}


/* =========================================================
   AUDIT
   ========================================================= */

function getAudit(
  audits,
  id
) {
  return (
    audits[id] || {
      score: null,
      displayValue: "",
      numericValue:
        null,
      details: null
    }
  );
}


function getFailedAudits(
  report
) {
  const audits =
    report.audits ||
    {};

  const failed = [];

  for (
    const [
      id,
      audit
    ] of Object.entries(
      audits
    )
  ) {
    if (
      !audit
    ) {
      continue;
    }

    if (
      audit.scoreDisplayMode ===
        "informative" ||
      audit.scoreDisplayMode ===
        "manual" ||
      audit.scoreDisplayMode ===
        "notApplicable"
    ) {
      continue;
    }

    if (
      typeof audit.score ===
        "number" &&
      audit.score < 0.9
    ) {
      failed.push({
        id,
        title:
          audit.title ||
          id,
        score:
          audit.score,
        displayValue:
          audit.displayValue ||
          ""
      });
    }
  }

  failed.sort(
    (
      a,
      b
    ) =>
      a.score -
      b.score
  );

  return failed.slice(
    0,
    20
  );
}


function getLcpElement(
  audits
) {
  const audit =
    getAudit(
      audits,
      "largest-contentful-paint-element"
    );

  try {
    const items =
      audit.details?.items ||
      [];

    if (
      items.length
    ) {
      return (
        items[0].node?.snippet ||
        items[0].node?.selector ||
        items[0].node?.nodeLabel ||
        ""
      );
    }
  } catch {}

  return "";
}


/* =========================================================
   SONUÇ
   ========================================================= */

function extractSummary(
  report,
  mode,
  url
) {
  const categories =
    report.categories ||
    {};

  const audits =
    report.audits ||
    {};

  function score(
    category
  ) {
    const value =
      categories[
        category
      ]?.score;

    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    return Math.round(
      value * 100
    );
  }

  function numeric(
    id
  ) {
    return (
      getAudit(
        audits,
        id
      ).numericValue ??
      null
    );
  }

  function display(
    id
  ) {
    return (
      getAudit(
        audits,
        id
      ).displayValue ||
      ""
    );
  }

  return {
    url,

    mode,

    lighthouseVersion:
      report.lighthouseVersion ||
      "",

    fetchedAt:
      report.fetchTime ||
      new Date().toISOString(),

    finalUrl:
      report.finalDisplayedUrl ||
      report.finalUrl ||
      url,

    scores: {
      performance:
        score(
          "performance"
        ),

      accessibility:
        score(
          "accessibility"
        ),

      bestPractices:
        score(
          "best-practices"
        ),

      seo:
        score(
          "seo"
        )
    },

    metrics: {
      fcp:
        numeric(
          "first-contentful-paint"
        ),

      lcp:
        numeric(
          "largest-contentful-paint"
        ),

      cls:
        numeric(
          "cumulative-layout-shift"
        ),

      tbt:
        numeric(
          "total-blocking-time"
        ),

      speedIndex:
        numeric(
          "speed-index"
        ),

      ttfb:
        numeric(
          "server-response-time"
        )
    },

    displayMetrics: {
      fcp:
        display(
          "first-contentful-paint"
        ),

      lcp:
        display(
          "largest-contentful-paint"
        ),

      cls:
        display(
          "cumulative-layout-shift"
        ),

      tbt:
        display(
          "total-blocking-time"
        ),

      speedIndex:
        display(
          "speed-index"
        ),

      ttfb:
        display(
          "server-response-time"
        )
    },

    lcpElement:
      getLcpElement(
        audits
      ),

    importantAudits: {
      renderBlocking:
        display(
          "render-blocking-resources"
        ),

      unusedJavaScript:
        display(
          "unused-javascript"
        ),

      unusedCSS:
        display(
          "unused-css-rules"
        ),

      modernImages:
        display(
          "modern-image-formats"
        ),

      offscreenImages:
        display(
          "offscreen-images"
        ),

      thirdParties:
        display(
          "third-party-summary"
        )
    },

    failedAudits:
      getFailedAudits(
        report
      )
  };
}


/* =========================================================
   ANA AKIŞ
   ========================================================= */

console.log(
  "========================================"
);

console.log(
  "KIRŞEHİR MANŞET LIGHTHOUSE 6.0"
);

console.log(
  "========================================"
);

console.log(
  "Site:",
  SITE_URL
);

console.log(
  "Maximum URL:",
  MAX_URLS
);


/*
 * Search Console feed zorunlu.
 * Böylece yanlışlıkla sitemap'e düşüp
 * eski/404 sayfaları taramayız.
 */

const rawTargetUrls =
  await getTargetUrls();


const selectedUrls =
  await buildValidTargetList(
    rawTargetUrls
  );


console.log(
  "Geçerli URL sayısı:",
  selectedUrls.length
);


if (
  !selectedUrls.length
) {
  throw new Error(
    "Geçerli Lighthouse URL'si bulunamadı."
  );
}


const results =
  [];

const errors =
  [];


/* =========================================================
   TESTLER
   ========================================================= */

for (
  let i = 0;
  i < selectedUrls.length;
  i++
) {
  const url =
    selectedUrls[i];

  console.log(
    `\n[${i + 1}/${selectedUrls.length}] ${url}`
  );

  for (
    const mode of
    [
      "mobile",
      "desktop"
    ]
  ) {
    const filename =
      `${String(
        i + 1
      ).padStart(
        2,
        "0"
      )}-${mode}.json`;

    const outputPath =
      path.join(
        REPORT_DIR,
        filename
      );

    try {
      console.log(
        mode.toUpperCase(),
        url
      );

      runLighthouse(
        url,
        mode,
        outputPath
      );

      const raw =
        await fs.readFile(
          outputPath,
          "utf8"
        );

      const report =
        JSON.parse(
          raw
        );

      results.push(
        extractSummary(
          report,
          mode,
          url
        )
      );

    } catch (
      error
    ) {
      console.error(
        "Lighthouse hatası:",
        error?.message ||
          error
      );

      errors.push({
        url,
        mode,
        error:
          String(
            error?.message ||
            error
          )
      });
    }
  }
}


/* =========================================================
   JSON
   ========================================================= */

const payload = {
  version: 6,

  site:
    SITE_URL,

  generatedAt:
    new Date().toISOString(),

  maxUrls:
    MAX_URLS,

  urlsAudited:
    selectedUrls,

  validUrlCount:
    selectedUrls.length,

  results,

  errors
};


await fs.writeFile(
  path.join(
    DATA_DIR,
    "latest.json"
  ),

  JSON.stringify(
    payload,
    null,
    2
  )
);


/* =========================================================
   MARKDOWN
   ========================================================= */

const markdown = [
  "# Kırşehir Manşet Lighthouse",
  "",
  `Site: ${SITE_URL}`,
  `Tarih: ${payload.generatedAt}`,
  `Taranan URL: ${selectedUrls.length}`,
  `Başarılı test: ${results.length}`,
  `Hata: ${errors.length}`,
  ""
];


for (
  const result of
  results
) {
  markdown.push(
    [
      `- ${result.mode.toUpperCase()}`,

      result.url,

      `Performance: ${result.scores.performance}`,

      `SEO: ${result.scores.seo}`,

      `Accessibility: ${result.scores.accessibility}`,

      `Best Practices: ${result.scores.bestPractices}`,

      `LCP: ${result.displayMetrics.lcp}`,

      `LCP Element: ${result.lcpElement}`,

      `CLS: ${result.displayMetrics.cls}`,

      `TBT: ${result.displayMetrics.tbt}`,

      `FCP: ${result.displayMetrics.fcp}`,

      `TTFB: ${result.displayMetrics.ttfb}`
    ].join(
      " | "
    )
  );
}


if (
  errors.length
) {
  markdown.push(
    "",
    "## Hatalar"
  );

  for (
    const error of
    errors
  ) {
    markdown.push(
      `- ${error.mode} | ${error.url} | ${error.error}`
    );
  }
}


await fs.writeFile(
  path.join(
    DATA_DIR,
    "latest.md"
  ),

  markdown.join(
    "\n"
  )
);


console.log(
  "========================================"
);

console.log(
  "LIGHTHOUSE TAMAMLANDI"
);

console.log(
  "Başarılı test:",
  results.length
);

console.log(
  "Hata:",
  errors.length
);

console.log(
  "========================================"
);
