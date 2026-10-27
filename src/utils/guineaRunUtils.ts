// cspell:ignore javascripts
/**
 * Guinea Run is the game hidden in the training site. The extension ships none
 * of it: its panel (src/webviews/guineaRunPanel.ts) frames the game page of the
 * site. These helpers decide where that frame points, which links the game
 * may open in the browser, and where the save shared by every project lives.
 * They touch no VS Code API, so unit tests call them directly.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** The training site, which serves the game */
export const GUINEA_RUN_SITE = "https://sfdx-hardis-training.cloudity.com";

/** The page of the site that plays the game alone, made for a frame */
export const GUINEA_RUN_PLAY_PATH = "/theme/javascripts/guinea-run/play.html";

/**
 * Points the frame at a local copy of the training site, for the screenshot
 * harness and the UI tests (ex: http://127.0.0.1:8765). Only a loopback
 * address is accepted. It is an environment variable on purpose, never a
 * setting: a workspace must not be able to change what the panel loads.
 */
export const GUINEA_RUN_SITE_ENV = "SFDX_HARDIS_GUINEA_RUN_SITE";

/** Sites the links of the game may open, always over https */
const GAME_LINK_HOSTS = [
  "sfdx-hardis-training.cloudity.com",
  "sfdx-hardis.cloudity.com",
  "cloudity.com",
  "www.cloudity.com",
];

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/**
 * The largest save the panel reads or writes. A real one is a few kilobytes:
 * anything bigger is not a save of the game.
 */
export const GUINEA_RUN_SAVE_MAX_BYTES = 512 * 1024;

/**
 * Origin of the site the frame loads: the training site, or the local copy
 * named by GUINEA_RUN_SITE_ENV when it is a loopback address.
 */
export function guineaRunSiteOrigin(override?: string): string {
  if (!override) {
    return GUINEA_RUN_SITE;
  }
  const site = parseUrl(override);
  if (
    site &&
    (site.protocol === "http:" || site.protocol === "https:") &&
    LOOPBACK_HOSTS.includes(site.hostname)
  ) {
    return site.origin;
  }
  return GUINEA_RUN_SITE;
}

/**
 * Address of the game page. The game speaks English and French: French when
 * the extension is displayed in French, English otherwise. save=host tells the
 * game that the panel keeps its save (see guineaRunSaveFile).
 */
export function guineaRunPlayUrl(siteOrigin: string, locale: string): string {
  const lang = (locale || "").toLowerCase().startsWith("fr") ? "fr" : "en";
  return `${siteOrigin}${GUINEA_RUN_PLAY_PATH}?lang=${lang}&from=vscode&save=host`;
}

/**
 * The save of the game, shared by every project and every VS Code profile:
 * the frame of the game keeps its own storage per project, so without it a
 * player would start again in each one. The game signs what it sends; the
 * extension stores it as it is and never reads it.
 */
export function guineaRunSaveFile(home: string = os.homedir()): string {
  return path.join(home, ".sfdx-hardis", "guinea-run-save.json");
}

/** The save as stored, or null when there is none, it is too big, or it cannot be read. */
export async function readGuineaRunSave(file: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > GUINEA_RUN_SAVE_MAX_BYTES) {
      return null;
    }
    return await fs.promises.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Writes the save the game sent. Returns false, without writing, for anything
 * but a non-empty string under GUINEA_RUN_SAVE_MAX_BYTES. Written to a
 * temporary file then renamed, so a closing VS Code never leaves half a save.
 */
export async function writeGuineaRunSave(
  file: string,
  blob: unknown,
): Promise<boolean> {
  if (
    typeof blob !== "string" ||
    blob.length === 0 ||
    Buffer.byteLength(blob, "utf8") > GUINEA_RUN_SAVE_MAX_BYTES
  ) {
    return false;
  }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(temp, blob, "utf8");
    await fs.promises.rename(temp, file);
    return true;
  } catch {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

/** Deletes the save: the game found it edited by hand. */
export async function deleteGuineaRunSave(file: string): Promise<void> {
  await fs.promises.rm(file, { force: true }).catch(() => undefined);
}

/**
 * The link to open in the browser for a link the player clicked in the game,
 * or null when it must be ignored: anything but https on one of
 * GAME_LINK_HOSTS, with no user name, password or port. The returned value is
 * the parsed address, so what opens is exactly what was checked.
 */
export function allowedGameLink(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }
  const link = parseUrl(url);
  if (
    !link ||
    link.protocol !== "https:" ||
    link.username !== "" ||
    link.password !== "" ||
    link.port !== "" ||
    !GAME_LINK_HOSTS.includes(link.hostname)
  ) {
    return null;
  }
  return link.href;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
