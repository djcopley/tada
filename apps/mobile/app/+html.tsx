import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

/**
 * WORKAROUND — not for mainline. See the commit message on this bookmark.
 *
 * iOS Safari refuses to fetch `apple-touch-icon` when the site's certificate is not publicly
 * trusted, and substitutes a generated letter tile instead:
 * https://developer.apple.com/forums/thread/92304. Reported against iOS 11, never fixed,
 * reproduced on iOS 18.7. Plain HTTP works and a publicly trusted certificate works; a privately
 * trusted root does not. Only the icon fetch is suppressed — the manifest is still read and web
 * push still works.
 *
 * Inlining the PNG as a data: URI means there is no network request for Safari to refuse. This
 * file runs in Node during `expo export`, so the bytes are read at build time and no encoded blob
 * is committed.
 *
 * Delete this the moment the host has a publicly trusted certificate.
 */
function iconDataUri(): string {
  const png = readFileSync(join(process.cwd(), 'public', 'icon-180.png'))
  return `data:image/png;base64,${png.toString('base64')}`
}

/**
 * Web-only. Configures the root HTML document for every page of the web export — this runs in
 * Node during export, not in the browser, so it has no access to the DOM or to app state.
 *
 * It exists because the web build is installed to an iPhone home screen as a PWA (the RN app
 * can't be installed on an MDM-managed device). Everything below is what turns a plain page into
 * something iOS will install with a real icon.
 */
export default function Root({ children }: PropsWithChildren) {
  const icon = iconDataUri()
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover is required for env(safe-area-inset-*) to report real values in a
            standalone PWA; without it react-native-safe-area-context sees zero insets on web and
            content collides with the notch. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        <link rel="manifest" href="/manifest.json" />

        {/* iOS ignores the manifest's icons for the home screen and reads apple-touch-icon
            instead; without it the tile is a generated letter. 180px is the size iOS wants, and
            it downscales for smaller slots itself. Older iOS reads only the -precomposed form,
            so both are emitted. Copies also sit at /apple-touch-icon.png, which iOS probes
            directly when it cannot use a link tag.

            Note: iOS will not fetch these at all when the certificate is not publicly trusted
            (https://developer.apple.com/forums/thread/92304). That only affects deployments
            behind a private CA; see the workaround/self-signed-cert-icon bookmark. */}
        <link rel="apple-touch-icon" sizes="180x180" href={icon} />
        <link rel="apple-touch-icon-precomposed" sizes="180x180" href={icon} />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />

        {/* Launches without Safari chrome when opened from the home screen. Safari also honours
            the manifest's display:standalone, but older iOS reads only this. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="tada" />
        {/* black-translucent lets the app paint its own ground behind the status bar, which is
            what the Instrument Ink night theme expects. Pairs with viewport-fit=cover above. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#1B1613" />

        {/* Registers the push service worker. Web-only and harmless where unsupported; the
            registration is also re-run by enableWebPush() so a user who opts in before this
            script lands still gets a worker. */}
        {/* The HTML is a static literal defined at the bottom of this file — no input reaches it,
            and inlining is the only way to get a script into the exported document. */}
        <script dangerouslySetInnerHTML={{ __html: swBootstrap }} />

        {/* Required by expo-router: without it ScrollView on web scrolls the body instead of the
            container, which breaks every scrollable screen. */}
        <ScrollViewStyleReset />

        {/* Installed to an iPhone home screen the web view does not cover the whole display: iOS
            insets it, reports env(safe-area-inset-*) as 0, and fills the strips above and below by
            propagating the *canvas* background — html/body. Leave that unset and they render
            white, so the app's ground stops at the edge of the view and the seam shows as a band
            over the status bar and under the tab strip. No CSS length reaches those strips; they
            are outside the view. src/design/documentGround.ts has the measurements and repaints
            this at runtime to follow the active screen.

            The literal here is night's ground, which is also the manifest's background_color, so
            the very first frame is right before any JS runs. overscroll-behavior stops the
            rubber-band bounce from exposing the same strips, and color-scheme keeps the UA from
            painting form controls and scrollbars light. */}
        <style
          dangerouslySetInnerHTML={{
            __html: 'html,body{background-color:#1B1613;overscroll-behavior:none}:root{color-scheme:dark}',
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}

// Deferred to `load` so registration never competes with the app's own boot requests, and guarded
// by feature detection because iOS Safari below 16.4 (and any non-secure origin) has no
// serviceWorker at all — the app must still run there, just without pings.
const swBootstrap = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.error('Service worker registration failed', err)
    })
  })
}
`
