import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

/**
 * Web-only. Configures the root HTML document for every page of the web export — this runs in
 * Node during export, not in the browser, so it has no access to the DOM or to app state.
 *
 * It exists because the web build is installed to an iPhone home screen as a PWA (the RN app
 * can't be installed on an MDM-managed device). Everything below is what turns a plain page into
 * something iOS will install with a real icon.
 */
export default function Root({ children }: PropsWithChildren) {
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
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
        <link rel="apple-touch-icon-precomposed" sizes="180x180" href="/icon-180.png" />
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

        {/* Required by expo-router: without it ScrollView on web scrolls the body instead of the
            container, which breaks every scrollable screen. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  )
}
