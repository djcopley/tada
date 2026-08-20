/* eslint-env serviceworker */
// Service worker for web push. Deliberately minimal: there is no offline story here, because the
// app is useless without the server — a cache layer would add staleness bugs and no capability.
//
// This file is served verbatim from the site root (Expo copies `public/` into the static export),
// so it is plain browser JS: no bundling, no imports, no TypeScript.

// skipWaiting + clients.claim so a redeployed worker takes over immediately. Without them a
// browser that already has an old worker keeps it until every tab closes, and a user who just
// opted in would get no notifications from the new code until then.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  // A push with no payload should still surface something rather than being swallowed: browsers
  // may drop the subscription of a worker that receives a push and shows nothing.
  let data = { title: 'tada', body: 'A run needs you.', ticketId: null }
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() }
    } catch {
      data.body = event.data.text()
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // Collapses repeat pings for the same ticket instead of stacking them up. The truthiness
      // check (not `!= null`) is deliberate — the server's test ping carries ticketId 0, which
      // is not a real ticket, so it must land in the generic bucket.
      tag: data.ticketId ? `ticket-${data.ticketId}` : 'tada',
      data: { ticketId: data.ticketId },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const ticketId = event.notification.data && event.notification.data.ticketId
  // Same falsy check as above: /tickets/0 does not exist, so a test ping opens the board root.
  const url = ticketId ? `/tickets/${ticketId}` : '/'
  // Focus an open window rather than piling up new ones.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c)
      if (existing) {
        // Both legs are chained into the promise waitUntil holds — a bare navigate() alongside
        // the returned focus() lets the browser kill the worker mid-navigation. navigate() is
        // not on every client type (and rejects cross-origin), so a failure to route still
        // falls through to focus rather than throwing out of waitUntil.
        const routed = 'navigate' in existing ? existing.navigate(url).catch(() => {}) : Promise.resolve()
        return routed.then(() => existing.focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
