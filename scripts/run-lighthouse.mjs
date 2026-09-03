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
   YARDIMCI
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


/* =========================================================
   APPS SCRIPT'TEN HEDEF URLLERİ AL
   ========================================================= */

async function getTargetUrls() {
  if (
    !TARGET_FEED_URL ||
    !TARGET_FEED_KEY
  ) {
    console.log(
      "TARGET_FEED_URL veya TARGET_FEED_KEY yok."
    );

    return [];
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
          "User-Agent":
            "KirsehirManset-Lighthouse/5.0",
          "Accept":
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
      response.status +
      ": " +
      text.slice(
        0,
        1000
      )
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
      "Target feed JSON döndürmedi. İlk cevap: " +
      text.slice(
        0,
        1000
      )
    );
  }

  if (
    data.error
  ) {
    throw new Error(
      "Target feed hatası: " +
      JSON.stringify(
        data.error
      )
    );
  }

  const urls =
    Array.isArray(
      data.urls
    )
      ? data.urls
      : [];

  const cleaned =
    urls
      .map(
        cleanUrl
      )
      .filter(
        url =>
          url &&
          sameHost(
            url,
            SITE_URL
          )
      );

  const unique =
    [
      ...new Set(
        cleaned
      )
    ];

  console.log(
    "Feed URL sayısı:",
    unique.length
  );

  return unique;
}


/* =========================================================
   FALLBACK SITEMAP
   ========================================================= */

async function fetchText(
  url
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "KirsehirManset-Lighthouse/5.0"
        }
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  return await response.text();
}


async function getSitemapUrls() {
  const base =
    new URL(
      SITE_URL
    );

  const candidates = [
    new URL(
      "/sitemap.xml",
      base
    ).href,

    new URL(
      "/sitemap_index.xml",
      base
    ).href,

    new URL(
      "/news-sitemap.xml",
      base
    ).href,

    new URL(
      "/news-sitemap_index.xml",
      base
    ).href
  ];

  try {
    const robots =
      await fetchText(
        new URL(
          "/robots.txt",
          base
        ).href
      );

    for (
      const line of
      robots.split(
        /\r?\n/
      )
    ) {
      if (
        /^sitemap:\s*/i.test(
          line
        )
      ) {
        candidates.unshift(
          line
            .replace(
              /^sitemap:\s*/i,
              ""
            )
            .trim()
        );
      }
    }

  } catch {
    console.log(
      "robots.txt okunamadı."
    );
  }

  const processed =
    new Set();

  const urls =
    new Set();


  async function readSitemap(
    sitemapUrl,
    depth = 0
  ) {
    if (
      depth > 3 ||
      processed.has(
        sitemapUrl
      )
    ) {
      return;
    }

    processed.add(
      sitemapUrl
    );

    let xml;

    try {
      xml =
        await fetchText(
          sitemapUrl
        );

    } catch {
      return;
    }

    const locations = [
      ...xml.matchAll(
        /<loc>\s*([^<]+)\s*<\/loc>/gi
      )
    ].map(
      match =>
        cleanUrl(
          match[1]
        )
    );

    const isIndex =
      /<sitemapindex\b/i.test(
        xml
      );

    if (
      isIndex
    ) {
      for (
        const location of
        locations
      ) {
        if (
          sameHost(
            location,
            SITE_URL
          )
        ) {
          await readSitemap(
            location,
            depth + 1
          );
        }
      }

      return;
    }

    for (
      const location of
      locations
    ) {
      if (
        sameHost(
          location,
          SITE_URL
        )
      ) {
        urls.add(
          location
        );
      }
    }
  }


  for (
    const candidate of
    [
      ...new Set(
        candidates
      )
    ]
  ) {
    await readSitemap(
      candidate
    );
  }

  return [
    ...urls
  ];
}


/* =========================================================
   URL SEÇİM MOTORU
   ========================================================= */

async function getAuditUrls() {
  let urls = [];

  try {
    urls =
      await getTargetUrls();

  } catch (error) {
    console.error(
      "Search Console feed alınamadı:"
    );

    console.error(
      error.message
    );
  }


  /*
   * Search Console feed başarılıysa
   * sitemap'e dönmeye gerek yok.
   */

  if (
    urls.length
  ) {
    return [
      cleanUrl(
        SITE_URL
      ),
      ...urls.filter(
        url =>
          cleanUrl(url) !==
          cleanUrl(SITE_URL)
      )
    ].slice(
      0,
      MAX_URLS
    );
  }


  /*
   * Feed çalışmazsa fallback olarak sitemap
   * kullanılır.
   */

  console.log(
    "Feed boş. Sitemap fallback devrede."
  );

  const sitemap =
    await getSitemapUrls();

  return [
    cleanUrl(
      SITE_URL
    ),
    ...sitemap.filter(
      url =>
        cleanUrl(url) !==
        cleanUrl(SITE_URL)
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
    mode === "desktop"
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
      stdio: "inherit"
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
      numericValue: null,
      details: null
    }
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
    ] of
    Object.entries(
      audits
    )
  ) {
    if (
      !audit ||
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


/* =========================================================
   SONUÇ ÇIKAR
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

    failedAudits:
      getFailedAudits(
        report
      )
  };
}


/* =========================================================
   DOSYA OLUŞTUR
   ========================================================= */

const urls =
  await getAuditUrls();

console.log(
  "\n========================================"
);

console.log(
  "KIRŞEHİR MANŞET LIGHTHOUSE 5.0"
);

console.log(
  "========================================"
);

console.log(
  "Site:",
  SITE_URL
);

console.log(
  "URL sayısı:",
  urls.length
);


if (
  !urls.length
) {
  throw new Error(
    "Taranacak URL bulunamadı."
  );
}


const results =
  [];

const errors =
  [];


for (
  let i = 0;
  i < urls.length;
  i++
) {
  const url =
    urls[i];


  for (
    const mode of
    [
      "mobile",
      "desktop"
    ]
  ) {
    const fileName =
      `${String(
        i + 1
      ).padStart(
        2,
        "0"
      )}-${mode}.json`;


    const outputPath =
      path.join(
        REPORT_DIR,
        fileName
      );


    try {
      console.log(
        `\n[${i + 1}/${urls.length}]`
      );

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
        error.message
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
   LATEST JSON
   ========================================================= */

const payload = {
  version: 5,

  site:
    SITE_URL,

  generatedAt:
    new Date().toISOString(),

  maxUrls:
    MAX_URLS,

  urlsAudited:
    urls,

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
   LATEST MARKDOWN
   ========================================================= */

const markdown = [
  "# Kırşehir Manşet Lighthouse",
  "",
  `Site: ${SITE_URL}`,
  `Tarih: ${payload.generatedAt}`,
  `Taranan URL: ${urls.length}`,
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
      result.mode.toUpperCase(),

      result.url,

      `Performance: ${result.scores.performance}`,

      `SEO: ${result.scores.seo}`,

      `Accessibility: ${result.scores.accessibility}`,

      `Best Practices: ${result.scores.bestPractices}`,

      `LCP: ${result.displayMetrics.lcp}`,

      `CLS: ${result.displayMetrics.cls}`,

      `TBT: ${result.displayMetrics.tbt}`,

      `FCP: ${result.displayMetrics.fcp}`,

      `TTFB: ${result.displayMetrics.ttfb}`,

      `LCP Element: ${result.lcpElement}`
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
      [
        error.mode,
        error.url,
        error.error
      ].join(
        " | "
      )
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
  "\n========================================"
);

console.log(
  "LIGHTHOUSE TAMAMLANDI"
);

console.log(
  "Başarılı:",
  results.length
);

console.log(
  "Hata:",
  errors.length
);

console.log(
  "========================================"
);
