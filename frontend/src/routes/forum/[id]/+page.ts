// Thread IDs only exist at runtime, so this route is never prerendered: deep
// links are served by the adapter-static fallback (see nginx.conf, which
// returns HTTP 200 for forum deep links) and rendered client-side.
export const prerender = false;
