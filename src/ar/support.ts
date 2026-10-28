/**
 * WebXR capability detection.
 *
 * Nothing here starts a session. It only asks the browser what it can do so
 * the landing screen can show honest, device-specific guidance before the
 * user taps "Start AR Experience".
 */

export type SupportLevel = 'ok' | 'warn' | 'err' | 'pending';

export interface SupportCheck {
  id: string;
  label: string;
  level: SupportLevel;
  detail: string;
}

export interface SupportReport {
  checks: SupportCheck[];
  /** True only when a real immersive-ar session can be requested. */
  canStartAr: boolean;
  summary: string;
}

function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

function isChromeLike(): boolean {
  return /chrome|chromium|crios|edg|samsungbrowser/i.test(navigator.userAgent);
}

export async function checkWebXrSupport(): Promise<SupportReport> {
  const checks: SupportCheck[] = [];

  // 1. Secure context: WebXR is only exposed over HTTPS (or localhost).
  const secure = window.isSecureContext;
  checks.push({
    id: 'https',
    label: 'Secure connection (HTTPS)',
    level: secure ? 'ok' : 'err',
    detail: secure
      ? 'Page is served over HTTPS.'
      : 'WebXR requires HTTPS. Open the deployed URL, not a plain http:// address.',
  });

  // 2. Platform hints. Guidance only; the real test is isSessionSupported.
  const android = isAndroid();
  checks.push({
    id: 'platform',
    label: 'Android device',
    level: android ? 'ok' : 'warn',
    detail: android
      ? 'Android detected.'
      : 'This version targets Android phones and tablets. Desktop browsers cannot start AR.',
  });

  const chromeLike = isChromeLike();
  checks.push({
    id: 'browser',
    label: 'Chrome-based browser',
    level: chromeLike ? 'ok' : 'warn',
    detail: chromeLike
      ? 'Chrome or a Chromium-based browser detected.'
      : 'Use Google Chrome on Android for the most reliable AR support.',
  });

  // 3. WebXR API present at all.
  const xr = navigator.xr;
  if (!xr) {
    checks.push({
      id: 'webxr',
      label: 'WebXR Device API',
      level: 'err',
      detail: 'navigator.xr is missing. Update Chrome or try a different browser.',
    });
    return {
      checks,
      canStartAr: false,
      summary: 'AR is not supported on this browser or device.',
    };
  }

  checks.push({
    id: 'webxr',
    label: 'WebXR Device API',
    level: 'ok',
    detail: 'navigator.xr is available.',
  });

  // 4. Immersive AR session support. On Android this also implies ARCore
  //    (Google Play Services for AR) is installed and the device is certified.
  let immersiveAr = false;
  let arDetail = '';
  try {
    immersiveAr = await xr.isSessionSupported('immersive-ar');
    arDetail = immersiveAr
      ? 'Device can start an immersive AR session.'
      : 'immersive-ar is not supported. Make sure "Google Play Services for AR" (ARCore) is installed and your device is ARCore-certified.';
  } catch (e) {
    arDetail = `isSessionSupported failed: ${(e as Error).message}`;
  }
  checks.push({
    id: 'immersive-ar',
    label: 'Immersive AR session',
    level: immersiveAr ? 'ok' : 'err',
    detail: arDetail,
  });

  return {
    checks,
    canStartAr: secure && immersiveAr,
    summary: immersiveAr
      ? 'Your device supports WebXR AR.'
      : 'AR is not supported on this browser or device.',
  };
}
