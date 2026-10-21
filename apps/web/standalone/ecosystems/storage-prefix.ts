// app/common/storage-prefix.ts for another ecosystem's single file: keys of its own in the browser.
declare const __ECOSYSTEM__: { storagePrefix: string };
export const STORAGE_PREFIX = __ECOSYSTEM__.storagePrefix;
