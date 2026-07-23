import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import StreamZip from "node-stream-zip";

const METAMASK_VERSION = "12.8.1";
const METAMASK_ASSET = `metamask-chrome-${METAMASK_VERSION}.zip`;
const METAMASK_RELEASE_URL = `https://api.github.com/repos/MetaMask/metamask-extension/releases/tags/v${METAMASK_VERSION}`;
const EXTENSION_PUB_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnpiOcYGaEp02v5On5luCk/4g9j+ujgWeGlpZVibaSz6kUlyiZvcVNIIUXR568uv5NrEi5+j9+HbzshLALhCn9S43E7Ha6Xkdxs3kOEPBu8FRNwFh2S7ivVr6ixnl2FCGwfkP1S1r7k665eC1/xYdJKGCc8UByfSw24Rtl5odUqZX1SaE6CsQEMymCFcWhpE3fV+LZ6RWWJ63Zm1ac5KmKzXdj7wZzN3onI0Csc8riBZ0AujkThJmCR8tZt2PkVUDX9exa0XkJb79pe0Ken5Bt2jylJhmQB7R3N1pVNhNQt17Sytnwz6zG2YsB2XNd/1VYJe52cPNJc7zvhQJpHjh5QIDAQAB";

interface GithubRelease {
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "zksync-upgrade-verification-tool",
};
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

const releaseResponse = await fetch(METAMASK_RELEASE_URL, { headers });
if (!releaseResponse.ok) {
  throw new Error(
    `Failed to fetch MetaMask release ${METAMASK_VERSION}: ${releaseResponse.status}`
  );
}

const release = (await releaseResponse.json()) as GithubRelease;
const asset = release.assets.find(({ name }) => name === METAMASK_ASSET);
if (!asset) {
  throw new Error(`MetaMask release ${METAMASK_VERSION} has no Chrome extension asset`);
}

const downloadRoot = path.join(os.tmpdir(), "dappwright", "metamask");
const extensionPath = path.join(downloadRoot, METAMASK_VERSION.replaceAll(".", "_"));
const archivePath = path.join(downloadRoot, METAMASK_ASSET);

await fs.rm(extensionPath, { recursive: true, force: true });
await fs.mkdir(downloadRoot, { recursive: true });

const assetResponse = await fetch(asset.browser_download_url);
if (!assetResponse.ok) {
  throw new Error(`Failed to download MetaMask ${METAMASK_VERSION}: ${assetResponse.status}`);
}
await fs.writeFile(archivePath, new Uint8Array(await assetResponse.arrayBuffer()));

try {
  const zip = new StreamZip.async({ file: archivePath });
  try {
    await zip.extract(null, extensionPath);
  } finally {
    await zip.close();
  }

  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.key = EXTENSION_PUB_KEY;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
} finally {
  await fs.rm(archivePath, { force: true });
}

console.log(`MetaMask ${METAMASK_VERSION} prepared at ${extensionPath}`);
