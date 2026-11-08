// Record audio comes from FormosanBank's Hugging Face mirror or the corpora's own publishers.
// Anything else a query response names is ignored, so it cannot make visitors' browsers
// contact other hosts or put arbitrary strings into their study decks. The page's
// media-src policy in index.html lists the same hosts. Add a host to both when a corpus
// publishes audio somewhere new.
const SOURCE_HOSTS = new Set([
  "e-dictionary.ilrdf.org.tw",
  "formosanbank.linguistics.ntu.edu.tw",
  "ilrdc.tw",
  "klokah.tw",
  "web.klokah.tw",
]);

export function trustedAudioUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    const mirror = url.hostname === "huggingface.co" && url.pathname.startsWith("/datasets/FormosanBank/");
    return mirror || SOURCE_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}
