// What the app keeps in the browser goes under keys starting with this: nothing here. The single
// file's Sepolia test build (standalone/sepolia-test) sets its own, so that page, opened next to
// verifier.html (every file:// page shares one origin), keeps its settings, wallet session, emergency
// payloads and chain cache apart.
export const STORAGE_PREFIX = "";
