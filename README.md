# WebAR Room Configurator

Browser-based multi-object AR for Android. Place TVs, tables and furniture in
a real room using WebXR (immersive-ar), Three.js, React and Vite. No native
app, no paid SDKs, no backend.

## Status

| Phase | Goal | State |
| ----- | ---- | ----- |
| 1 | React + TypeScript + Vite + Three.js project, landing screen, WebXR support check | Done |
| 2 | Real immersive-ar session starts on an Android device | Done, verified on device |
| 3 | Hit-testing, reticle, cubes placed on the floor with anchors | Done, verified on device |
| 4 | Wall placement: hit-test, depth estimate, floor-edge fallback; placeholder TV | Built, awaiting phone test |
| 5 | Multi-object manager and touch manipulation | Next |
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
    ArEngine.ts       WebXR session, renderer, hit-test/depth reticle, anchors, placement
    models.ts         Placeholder cube and TV built from primitives (GLB later)
  components/
    Landing.tsx       Start screen, device check, instructions
    ArOverlay.tsx     In-session UI (dom-overlay): status, details, Exit
  styles/global.css   Mobile-first styles
public/models/        GLB assets (added in later phases)
docs/
  android-testing-checklist.md
  troubleshooting.md
```

## UI preview without a phone

Open the site with `?ui=preview` to see the in-session overlay UI on a
desktop. It is clearly labelled and starts no AR session.

## Honest limitations

- Only Android Chrome is targeted. iOS Safari does not implement WebXR AR.
- Vertical (wall) hit-testing is not guaranteed. WebXR only reports a wall
  when ARCore has detected a vertical plane, which needs a textured wall and
  time; plain painted walls are often never detected. On the first test
  device the floor was detected within seconds and the wall never was.
  Wall mode therefore uses, in order:
  1. A real vertical hit-test result when one exists (green ring).
  2. The WebXR depth-sensing API, reading the distance at the screen centre
     and assuming a vertical wall facing the user (blue ring, labelled
     "estimated"). Only on devices that grant `depth-sensing`.
  3. A clearly labelled manual fallback: aim at the floor where it meets the
     wall; the TV is mounted 1.2 m above that point facing the user (amber
     ring). Phase 5 adds move and rotate controls to fine-tune it.
  The method used is always shown in the guide text and the "i" panel.
- Exported JSON stores virtual coordinates relative to the AR session origin.
  Re-importing in a new session does not restore objects to the same
  real-world spot without persistent anchors.
