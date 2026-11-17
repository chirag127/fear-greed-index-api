/**
 * GA4 snippet, emitted only when PUBLIC_GA4_ID is a valid measurement ID.
 * Host allowlist (PUBLIC_GA_HOSTS) is enforced in the browser since the build
 * artifact is static and served from more than one hostname.
 * Consent Mode v2 defaults to denied.
 */
export function analyticsSnippet(id = process.env.PUBLIC_GA4_ID, hosts = process.env.PUBLIC_GA_HOSTS) {
  const measurementId = (id || '').trim();
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) return '';
  const allow = (hosts || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (!allow.length) return '';
  return `<script>
(function () {
  var ID = ${JSON.stringify(measurementId)};
  var HOSTS = ${JSON.stringify(allow)};
  if (HOSTS.indexOf(location.hostname) === -1) return;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied'
  });
  gtag('config', ID, { anonymize_ip: true, send_page_view: true });
})();
</script>`;
}
