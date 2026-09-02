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
  { recursive: true }
);


/* =========================================================
   HTTP
   ========================================================= */

async function fetchText(url) {
  const response = await fetch(
    url,
    {
      headers: {
        "user-agent":
          "KirsehirManset-Lighthouse/1.0"
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
  return String(url || "")
    .trim()
    .replace(/#.*$/, "");
}


function sameHost(a, b) {
  try {
    const hostA =
      new URL(a)
        .hostname
        .replace(/^www\./, "")
        .toLowerCase();

    const hostB =
      new URL(b)
        .hostname
        .replace(/^www\./, "")
        .toLowerCase();

    return hostA === hostB;

  } catch {
    return false;
  }
}


/* =========================================================
   SITEMAP
   ========================================================= */

async function getSitemapUrls(siteUrl) {
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
      robots.split(/\r?\n/)
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
    // robots.txt okunamazsa
    // standart sitemap yolları kullanılacak.
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
      processed.has(sitemapUrl)
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

    const locations =
      [
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
   SONUÇLARI ÖZETLE
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
      audits[id]
        ?.numericValue ??
      null
    );
  }


  function display(
    id
  ) {
    return (
      audits[id]
        ?.displayValue ||
      ""
    );
  }


  return {
    url,

    mode,

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
    }
  };
}


/* =========================================================
   ANA İŞLEM
   ========================================================= */

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
        `\n========================================`
      );

      console.log(
        `Lighthouse ${mode}:`
      );

      console.log(
        url
      );

      console.log(
        `========================================\n`
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
   JSON ÇIKTI
   ========================================================= */

const payload = {
  version: 1,

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
   OKUNABİLİR RAPOR
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
      `CLS: ${result.displayMetrics.cls}`,
      `TBT: ${result.displayMetrics.tbt}`,
      `FCP: ${result.displayMetrics.fcp}`,
      `TTFB: ${result.displayMetrics.ttfb}`
    ].join(" | ")
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

  markdown.join("\n")
);


console.log(
  "\nLighthouse işlemi tamamlandı."
);

console.log(
  `Taranan URL: ${selectedUrls.length}`
);

console.log(
  `Başarılı test: ${results.length}`
);

console.log(
  `Hata: ${errors.length}`
);
