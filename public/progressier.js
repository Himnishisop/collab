try {
  importScripts("https://progressier.app/eeSMCaM6JWsByNM83KLc/sw.js");
} catch {
  // Offline or blocked
}
try {
  importScripts("/sw.js");
} catch {
  // Local SW already active
}
