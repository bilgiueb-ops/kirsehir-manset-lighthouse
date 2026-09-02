import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SITE_URL =
  process.env.SITE_URL ||
  "https://kirsehirmanset.com/";

const MAX_URLS =
  Number(process.env.MAX_URLS || 6);

const DATA_DIR =
  path.resolve("data");

const REPORT_DIR =
  path.join(DATA_DIR, "reports");

await fs.mkdir(
  REPORT_DIR,
  {
    recursive: true
  }
);


/* =========================================================
   HTTP
   ========================================================= */

async function fetchText(url) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "user-agent":
            "KirsehirManset-Lighthouse/2.0"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  return await response.text();
}


/* =========================================================
   URL
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
   SITEMAP
   ========================================================= */

async function getSitemapUrls(
  siteUrl
) {
  const base =
    new URL(siteUrl);

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
      "robots.txt okunamadi."
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
      /<sitemapindex\b/i
        .test(xml);


    if (isIndex) {
      for (
        const location of
        locations
      ) {
        if (
          sameHost(
            location,
            siteUrl
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
          siteUrl
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
    [...new Set(candidates)]
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
   LIGHTHOUSE ÇALIŞTIR
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
   AUDIT DEĞERİ
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


/* =========================================================
   BAŞARISIZ AUDITLER
   ========================================================= */

function getFailedAudits(
  report
) {
  const audits =
    report.audits || {};

  const result = [];

  for (
    const [id, audit] of
    Object.entries(audits)
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
      result.push({
        id,

        title:
          audit.title || id,

        score:
          audit.score,

        displayValue:
          audit.displayValue || ""
      });
    }
  }

  result.sort(
    (a, b) =>
      a.score - b.score
  );

  return result.slice(
    0,
    15
  );
}


/* =========================================================
   LCP ÖĞESİ
   ========================================================= */

function getLcpElement(
  audits
) {
  const audit =
    getAudit(
      audits,
      "largest-contentful-paint-element"
    );

  if (
    !audit.details
  ) {
    return "";
  }

  try {
    const items =
      audit.details.items || [];

    if (
      items.length &&
      items[0]
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
   ANA SONUÇ
   ========================================================= */

function extractSummary(
  report,
  mode,
  url
) {
  const categories =
    report.categories || {};

  const audits =
    report.audits || {};


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
   ANA TARAYICI
   ========================================================= */

console.log(
  "Kirsehir Manset Lighthouse 2.0 basliyor..."
);

console.log(
  "Site:",
  SITE_URL
);


const sitemap =
  await getSitemapUrls(
    SITE_URL
  );


const selectedUrls = [
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


console.log(
  "Taranacak URL:",
  selectedUrls.length
);


const results = [];
const errors = [];


for (
  let i = 0;
  i < selectedUrls.length;
  i++
) {
  const url =
    selectedUrls[i];


  for (
    const mode of
    [
      "mobile",
      "desktop"
    ]
  ) {
    const filename =
      `${String(i + 1).padStart(2, "0")}-${mode}.json`;

    const outputPath =
      path.join(
        REPORT_DIR,
        filename
      );


    try {
      console.log(
        `Lighthouse ${mode}: ${url}`
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


    } catch (error) {
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
  version: 2,

  site:
    SITE_URL,

  generatedAt:
    new Date().toISOString(),

  maxUrls:
    MAX_URLS,

  urlsAudited:
    selectedUrls,

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
  "# Kirsehir Manset Lighthouse",
  "",
  `Site: ${SITE_URL}`,
  `Tarih: ${payload.generatedAt}`,
  `Taranan URL: ${selectedUrls.length}`,
  `Basarili test: ${results.length}`,
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
  "Lighthouse islemi tamamlandi."
);

console.log(
  `Basarili test: ${results.length}`
);

console.log(
  `Hata: ${errors.length}`
);
