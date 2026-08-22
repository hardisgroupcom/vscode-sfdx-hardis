// Refreshes the README badges that no live badge URL can compute anymore:
// shields.io retired its visual-studio-marketplace endpoints, so the Marketplace
// install count has to be read from the Marketplace API and written as a static
// shields.io badge in README.md. Every other badge of the README is a live URL
// and must stay out of this script.
// Run manually with `yarn sync:badges`, or let the Update Badges workflow do it.
const fs = require("fs");
const https = require("https");
const path = require("path");

const EXTENSION_ID = "NicolasVuillamy.vscode-sfdx-hardis";
const MARKETPLACE_API_URL =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const README_PATH = path.resolve(__dirname, "..", "README.md");
const USER_AGENT = "vscode-sfdx-hardis-badge-sync";

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          // The Marketplace API only answers JSON when this exact Accept header
          // is sent, otherwise it replies with XML
          Accept: "application/json;api-version=3.0-preview.1",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": USER_AGENT,
        },
      },
      (response) => {
        const { statusCode } = response;

        if (statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `Unexpected status code ${statusCode} while calling ${url}`,
            ),
          );
          return;
        }

        let rawData = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawData += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(rawData));
          } catch (error) {
            reject(
              new Error(`Invalid JSON returned by ${url}: ${error.message}`),
            );
          }
        });
      },
    );

    request.on("error", (error) => {
      reject(error);
    });
    request.write(body);
    request.end();
  });
}

async function fetchMarketplaceStats() {
  const response = await postJson(MARKETPLACE_API_URL, {
    filters: [
      {
        criteria: [{ filterType: 7, value: EXTENSION_ID }],
        pageNumber: 1,
        pageSize: 1,
      },
    ],
    // Include statistics (256)
    flags: 256,
  });

  const extension = response?.results?.[0]?.extensions?.[0];

  if (!extension) {
    throw new Error(`Extension ${EXTENSION_ID} not found on the Marketplace`);
  }

  const installs = extension.statistics?.find((stat) => {
    return stat.statisticName === "install";
  })?.value;

  if (typeof installs !== "number") {
    throw new Error("Marketplace answered without an install count");
  }

  return installs;
}

function formatCount(count) {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

// shields.io uses dashes and underscores as separators in static badges
function escapeBadgeText(text) {
  return encodeURIComponent(text.replace(/-/g, "--").replace(/_/g, "__"));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyBadge(content, badge) {
  const encodedLabel = encodeURIComponent(badge.label);
  const pattern = new RegExp(
    `https://img\\.shields\\.io/badge/${escapeRegExp(encodedLabel)}-[^)\\s]*`,
    "g",
  );

  if (!pattern.test(content)) {
    throw new Error(
      `No badge found in README.md for label "${badge.label}". ` +
        `Expected a https://img.shields.io/badge/${encodedLabel}-... URL.`,
    );
  }

  const url = `https://img.shields.io/badge/${encodedLabel}-${escapeBadgeText(badge.value)}-${badge.color}`;
  return content.replace(pattern, url);
}

async function main() {
  try {
    const installs = await fetchMarketplaceStats();

    const badges = [
      {
        label: "VS Code installs",
        value: formatCount(installs),
        color: "blue",
      },
    ];

    const previousContent = await fs.promises.readFile(README_PATH, "utf8");
    let content = previousContent;

    for (const badge of badges) {
      content = applyBadge(content, badge);
      console.log(`${badge.label}: ${badge.value}`);
    }

    if (content === previousContent) {
      console.log("Badges already up to date.");
      return;
    }

    await fs.promises.writeFile(README_PATH, content, "utf8");
    console.log("README badges updated.");
  } catch (error) {
    console.error("Failed to update badges:", error.message);
    process.exit(1);
  }
}

main();
