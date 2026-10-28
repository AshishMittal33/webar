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

## Phase 3: hit-testing and floor placement

- [ ] Start AR. Point the camera at the floor and move slowly. A green ring
      (the reticle) appears on the floor within a few seconds.
- [ ] Move the phone: the ring slides along the floor and stays flat on it.
- [ ] Point at a wall. The ring should turn amber and the guide text should
      say "Wall detected". Note whether this happens at all on your device:

      Wall reticle appears: yes / no   Device: ______________

- [ ] Point at the floor again and press "Place cube". A blue cube appears
      sitting on the floor at the ring, not floating or sunk into it.
- [ ] Tap anywhere on the empty camera view (not on a button). Another cube
      appears at the ring. Tapping the "i" or "Exit AR" buttons must NOT
      place a cube.
- [ ] Place 3 or 4 cubes in different spots. Walk around the room and come
      back. All cubes are still where you put them.
- [ ] Open "i". "Anchors" should read "supported (N/N anchored)" with N equal
      to the number of cubes. If it says 0 anchored, anchors are not working
      on this device; cubes still work but may drift slightly.
- [ ] Press "Clear". All cubes disappear and the counter resets.
- [ ] Exit AR and Start again. The scene is empty (objects do not survive a
      session; this is expected until save/restore in Phase 6).

## Phase 4: wall placement (TV)

Wall detection is not guaranteed on Android. The app tries three methods and
always says which one is active in the guide text and in the "i" panel.

- [ ] Start AR, scan the floor until tracking is green, then tap "Wall (TV)".
- [ ] Aim at a wall with some texture (poster, switch plate, door frame) and
      hold still for 10 to 20 seconds. If a green ring appears flat on the
      wall and the guide says "Wall detected", automatic wall detection works
      on this device. Record it:

      Automatic wall detection: yes / no   Device: ______________

- [ ] If instead a BLUE ring appears with "Wall estimated from depth", depth
      sensing is active. Press "Place TV". The TV should appear flat against
      the wall, facing you, roughly where the ring was.
- [ ] If an AMBER ring appears only when aiming at the floor and the guide
      says "No wall detected. Manual mode", use the floor-edge method: aim at
      the line where the wall meets the floor and press "Place TV". The TV
      is mounted 1.2 m above that point, facing you.
- [ ] Place three TVs side by side on the same wall. Walk to the side and
      check they are flat against the wall, not floating in the room or
      sunk into it. Small errors are expected with depth and floor-edge.
- [ ] Open "i": read "Depth sensing", "Last wall placement" and "Anchors".
- [ ] Switch back to "Floor" and place a cube on the floor in the same
      session. TVs and cube all stay in place.

## Phase 5 and later

Added when those phases are implemented.
