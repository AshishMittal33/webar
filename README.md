# WebAR Room Configurator

Browser-based multi-object AR for Android. Place TVs, tables and furniture in
a real room using WebXR (immersive-ar), Three.js, React and Vite. No native
app, no paid SDKs, no backend.

## Status

| Phase | Goal | State |
| ----- | ---- | ----- |
| 1 | React + TypeScript + Vite + Three.js project, landing screen, WebXR support check | Done |
| 2 | Real immersive-ar session starts on an Android device | Done, verified on device |
| 3 | Hit-testing and floor placement (verified on device) | Superseded by spawn-and-adjust |
| 4 | Wall placement investigation: hit-test, depth, two-point wall line | Investigated; superseded, see limitations |
| 5 | Multi-object manager, spawn in front of user, drag/pinch/twist + button controls, undo | Built, awaiting phone test |
| 6 | Catalogue, error handling, performance, JSON export/import | Pending |
| 7 | Free HTTPS deployment and QR code | Pending |

## Requirements

- Node.js 20 or 22 (tested with 22.11)
- Android phone or tablet that is ARCore-certified, with
  "Google Play Services for AR" installed, running a recent Google Chrome

## Development

```bash
npm install
npm run dev
```

The dev server listens on all network interfaces over HTTPS with a
self-signed certificate (WebXR refuses plain HTTP). To test on a phone:

1. Connect the phone to the same Wi-Fi as this computer.
2. Note the "Network" URL that Vite prints, e.g. `https://192.168.1.20:5173/`.
3. Open it in Chrome on the phone. Chrome shows a certificate warning for the
   self-signed cert: tap Advanced, then Proceed.
4. The landing screen shows a device check. Tap "Show details" to see which
   WebXR capabilities the device exposes.

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | HTTPS dev server, hot reload |
| `npm run build` | Typecheck then production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only |

## Project layout

```
index.html            Entry HTML (mobile viewport, no zoom)
vite.config.ts        Vite + React + HTTPS dev cert, three.js split chunk
src/
  main.tsx            React root
  App.tsx             Screen switching (landing / AR)
  ar/
    support.ts        WebXR capability detection (no session started)
    types.ts          Tracking state, session info, error mapping
    ArEngine.ts       WebXR session, renderer, object manager, gestures, undo
    models.ts         Catalogue of placeholder models (TV, box); GLB later
  components/
    Landing.tsx       Start screen, device check, instructions
    ArOverlay.tsx     In-session UI: status, catalogue, control pad, gesture layer
  styles/global.css   Mobile-first styles
public/models/        GLB assets (added in later phases)
docs/
  android-testing-checklist.md
  troubleshooting.md
```

## UI preview without a phone

Open the site with `?ui=preview` to see the in-session overlay UI on a
desktop. It is clearly labelled and starts no AR session.

## How placement works now (and why)

Objects are spawned about 1.5 m in front of the user and then positioned by
hand: drag to slide, pinch to resize, twist two fingers to rotate, move two
fingers up or down to push the object away or pull it closer, or use the
precise buttons (5 cm steps, 10 degree turns). Objects are fixed in the AR
session's local coordinate space and never move on their own.

Hit-testing is used only to learn the floor height so boxes and furniture
spawn on the floor. TVs spawn at eye height facing the user.

## Honest limitations

- Only Android Chrome is targeted. iOS Safari does not implement WebXR AR.
- Automatic wall placement was investigated in Phase 4 and dropped:
  - WebXR vertical hit-testing only works once ARCore has detected a
    vertical plane. On the test tablet the floor was found in seconds but a
    plain painted wall was never detected (a textured door was).
  - The depth-sensing API can estimate a wall, but requesting it made
    tracking noticeably worse on the test tablet.
  - ARCore loses tracking when the camera sees only blank wall, on any
    device, because there are no visual features. No app can fix this.
    Users should stand back and keep floor or furniture in view.
  - ARCore anchors continuously nudge object poses; near a blank wall those
    corrections are noisy and made TVs shiver. Objects are therefore kept
    static in local space instead of anchored.
  The engine can still read hit-test and depth results, so a future version
  can offer "snap to detected wall" where a device supports it.
- Exported JSON stores virtual coordinates relative to the AR session origin.
  Re-importing in a new session does not restore objects to the same
  real-world spot without persistent anchors.
