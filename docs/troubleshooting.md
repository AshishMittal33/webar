# Troubleshooting

## Landing screen says "Not supported"

Tap "Show details" and find the failing line.

| Failing line | What it means | Fix |
| ------------ | ------------- | --- |
| Secure connection (HTTPS) | Page opened over plain http:// | Use the https:// URL. WebXR is hidden on insecure pages. |
| Android device | Not an Android phone or tablet | Only Android is supported in this version. iOS Safari has no WebXR AR. |
| Chrome-based browser | Firefox or another browser | Open the URL in Google Chrome. |
| WebXR Device API | Chrome is too old or WebXR is disabled | Update Chrome from the Play Store. Check chrome://flags does not disable WebXR. |
| Immersive AR session | ARCore missing or device not certified | Install "Google Play Services for AR" from the Play Store. Check the device is on Google's ARCore supported list. |

## AR starts but the status stays "Initialising"

Tracking needs visual features. Point the camera at a textured floor or
furniture in good light and move the phone slowly in an arc. Plain white
walls, dark rooms and very fast movement all delay tracking.

## "Camera access was denied"

In Chrome, tap the lock icon next to the address, open Permissions, set
Camera to Allow, then reload and tap Start again. If Camera does not appear
there, open Android Settings, Apps, Chrome, Permissions, Camera.

## "The AR session was ended by the browser"

Android ends the AR session when you switch apps, lock the screen or get a
full-screen call. This is expected. Tap Start to begin a new session. Objects
from the previous session are not restored in Phase 2.

## Certificate warning on the dev server

The local dev server uses a self-signed certificate. Chrome shows "Your
connection is not private". Tap Advanced, then "Proceed to 192.168.x.x".
This never happens on the deployed Cloudflare Pages URL.

## Blue cube drifts or follows the camera

That indicates poor tracking, not a code bug. Try better lighting and a more
textured environment. If it always happens on one device, record the device
model in the testing checklist.
