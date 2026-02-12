import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const DIST_DIR = path.resolve("dist");
const ASSETS_DIR = path.join(DIST_DIR, "assets");

async function main() {
  try {
    const s = await stat(ASSETS_DIR);
    if (!s.isDirectory()) return;
  } catch {
    return;
  }

  const entries = await readdir(ASSETS_DIR, { withFileTypes: true });
  const bins = entries.filter((e) => e.isFile() && e.name.endsWith(".bin")).map((e) => e.name);
  if (bins.length === 0) return;

  let saved = 0;
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const name of bins) {
    const filePath = path.join(ASSETS_DIR, name);
    const raw = await readFile(filePath);
    beforeBytes += raw.byteLength;

    const br = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    });

    await writeFile(filePath, br);
    if (br.byteLength < raw.byteLength) {
      saved += raw.byteLength - br.byteLength;
    }
    afterBytes += br.byteLength;
  }

  if (saved > 0) {
    // eslint-disable-next-line no-console
    console.log(`[compress] .bin brotli: ${beforeBytes} -> ${afterBytes} bytes (saved ${saved})`);
  }
}

await main();
