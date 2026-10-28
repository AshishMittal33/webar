# Android device testing checklist

Run this on a real phone after every phase. Record the phone model, Android
version and Chrome version with each result so problems can be traced.

## Setup (once per phone)

- [ ] Phone is on the ARCore supported-devices list and "Google Play Services
      for AR" is installed and up to date (Play Store).
- [ ] Google Chrome is updated to the current stable version.
- [ ] Phone and PC are on the same Wi-Fi (for dev server testing).
- [ ] `npm run dev` is running on the PC. Open the "Network" URL that Vite
      prints (https://192.168.x.x:5173) in Chrome on the phone.
- [ ] Accept the self-signed certificate warning: Advanced, then Proceed.
      Only needed for the dev server; the deployed site has a real certificate.

## Phase 1: landing screen

- [ ] Page loads and fits the screen without horizontal scrolling.
- [ ] "Device check" shows Ready.
- [ ] "Show details" lists all checks as OK.
- [ ] If it says Not supported, note which line fails and see
      [troubleshooting](troubleshooting.md).

## Phase 2: real AR session

- [ ] Tap "Start AR Experience". Chrome asks for camera permission the first
      time. Allow it.
- [ ] The live camera feed appears full screen with the status pill, the "i"
      button and "Exit AR" drawn on top.
- [ ] Status pill goes from Initialising (amber) to Tracking (green) within a
      few seconds while moving the phone slowly.
- [ ] A small blue spinning cube appears about 1 metre in front of where the
      phone was pointing when tracking started.
- [ ] Walk around the cube. It must stay fixed in the room, not follow the
      camera. This is the proof that real tracking is working.
- [ ] Cover the camera with your hand for 3 seconds. Status should change to
      Limited or Lost and the guide text should change. Uncover: it recovers.
- [ ] Tap "i". Note the "Granted" feature list. We need `dom-overlay` and
      `hit-test` for Phase 3, and `anchors` is useful for later phases.
      Write the list down here:

      Phone: ______________  Granted: ______________________________

- [ ] Tap "Exit AR". The landing screen returns without a reload.
- [ ] Tap Start again. A second session starts cleanly.
- [ ] Start AR, then press the phone's Home button. Return to Chrome. The
      landing screen should show "The AR session was ended by the browser"
      and Start should work again.
- [ ] Deny camera permission once (clear site settings in Chrome, Start, tap
      Block). The landing screen shows "Camera access was denied" with the
      instructions to re-enable it.

## Phase 3 and later

Added when those phases are implemented.
