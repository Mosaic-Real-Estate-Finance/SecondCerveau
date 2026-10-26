// Hands a Notion page to the Notion app, from the installed app. The same
// as public/notion.html, which does it when a notification opens the app
// cold: iOS answers to Notion's own scheme, Android to an intent naming the
// app; if nothing has taken the link a moment later — Notion is not
// installed — the web address opens in the browser.

const NOTION_HOST = /(^|\.)notion\.(so|com|site)$/;

export function openInNotion(href: string) {
  let page: URL;
  try {
    page = new URL(href);
  } catch {
    return;
  }
  if (page.protocol !== "https:" || !NOTION_HOST.test(page.hostname)) return void window.open(href, "_blank");
  const rest = page.host + page.pathname + page.search + page.hash;
  const android = /Android/i.test(navigator.userAgent);
  let taken = false;
  const away = () => {
    if (document.visibilityState === "hidden") taken = true;
  };
  document.addEventListener("visibilitychange", away);
  window.location.href = android
    ? `intent://${rest}#Intent;scheme=https;package=notion.id;S.browser_fallback_url=${encodeURIComponent(page.href)};end`
    : `notion://${rest}`;
  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", away);
    if (!taken && document.visibilityState === "visible") window.open(page.href, "_blank", "noopener");
  }, 1500);
}
