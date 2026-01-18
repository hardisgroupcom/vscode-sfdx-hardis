const fs = require("fs");
const https = require("https");
const path = require("path");

const REMOTE_URL =
  "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/refs/heads/main/config/sfdx-hardis.jsonschema.json";
const DESTINATION_PATH = path.resolve(
  __dirname,
  "..",
  "resources",
  "sfdx-hardis.jsonschema.json",
);
const MAX_REDIRECTS = 5;

function fetchRemote(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while fetching ${url}`));
      return;
    }

    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "vscode-sfdx-hardis-schema-sync",
        },
      },
      (response) => {
        const { statusCode, headers } = response;

        if (
          statusCode &&
          statusCode >= 300 &&
          statusCode < 400 &&
          headers.location
        ) {
          response.resume();
          resolve(fetchRemote(headers.location, redirectCount + 1));
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `Unexpected status code ${statusCode} while fetching schema`,
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
          resolve(rawData);
        });
      },
    );

    request.on("error", (error) => {
      reject(error);
    });
  });
}

async function main() {
  try {
    const remoteContent = await fetchRemote(REMOTE_URL);

    JSON.parse(remoteContent);

    const localContent = await fs.promises
      .readFile(DESTINATION_PATH, "utf8")
      .catch(() => {
        return null;
      });

    if (localContent === remoteContent) {
      console.log("Schema already up to date.");
      return;
    }

    await fs.promises.writeFile(DESTINATION_PATH, remoteContent, "utf8");
    console.log("Schema synchronized to the latest remote version.");
  } catch (error) {
    console.error("Failed to synchronize schema:", error.message);
    process.exit(1);
  }
}

main();
