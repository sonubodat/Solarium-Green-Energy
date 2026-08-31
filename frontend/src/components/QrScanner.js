import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Physical QR codes encode the full referral URL (".../v/V-0001"), not the bare code, but the
// scanner also needs to accept a pasted/typed bare code directly. Strictly validates both forms
// instead of falling back to "whatever text was decoded" — a misread camera frame or a pasted
// unrelated URL/QR must not silently become "the QR code" and get sent to the backend as one.
// Returns '' (not the raw input) when nothing recognizable was found.
export function extractQrCode(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/v\/([^/]+)\/?$/i);
    if (match) {
      const code = decodeURIComponent(match[1]).trim();
      return /^V-\d+$/i.test(code) ? code.toUpperCase() : '';
    }
    // A well-formed URL that isn't a Solarium referral link — never fall through to
    // treating the whole URL as a bare code.
    return '';
  } catch {
    // Not a URL — fall through to bare-code matching below.
  }

  return /^V-\d+$/i.test(trimmed) ? trimmed.toUpperCase() : '';
}

const SCAN_INTERVAL_MS = 80; // ~12 decode attempts/sec — plenty for a printed sticker, far
                              // cheaper than decoding on every animation frame (~60/sec).

// Maps real getUserMedia failure reasons to an accurate message instead of a single generic
// "permission denied" for every possible cause (wrong camera busy, insecure context, etc).
function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access in your browser settings, or enter the code manually.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Enter the code manually instead.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another app. Close it and try again, or enter the code manually.';
    case 'OverconstrainedError':
      return "This device doesn't have a rear camera matching what was requested. Enter the code manually instead.";
    case 'SecurityError':
      return 'Camera access requires a secure (HTTPS) connection. Enter the code manually instead.';
    default:
      return 'Unable to access the camera. Enter the code manually instead.';
  }
}

function QrScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const scanningRef = useRef(false);
  const detectedRef = useRef(false); // one-shot lock — the same physical code sitting in
                                      // frame for multiple decode cycles must only fire once.
  const lastScanAtRef = useRef(0);
  const [cameraError, setCameraError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState('');
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera scanning is not supported in this browser. Enter the code manually instead.');
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (cancelled) return;
        setStarting(false);
        scanningRef.current = true;
        scanFrame();
      } catch (requestError) {
        // eslint-disable-next-line no-console
        console.error('QR camera error:', requestError);
        if (!cancelled) {
          setCameraError(cameraErrorMessage(requestError));
          setStarting(false);
        }
      }
    }

    function stopCamera() {
      scanningRef.current = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    function scanFrame() {
      if (!scanningRef.current || detectedRef.current) return;

      const now = performance.now();
      if (now - lastScanAtRef.current < SCAN_INTERVAL_MS) {
        frameRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      lastScanAtRef.current = now;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA || !video.videoWidth) {
        frameRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      // Decode only the central square, matching the visible scan frame — cheaper than the
      // full camera image and avoids picking up an unrelated QR code at the frame's edge.
      const sourceSize = Math.min(video.videoWidth, video.videoHeight);
      const sourceX = Math.floor((video.videoWidth - sourceSize) / 2);
      const sourceY = Math.floor((video.videoHeight - sourceSize) / 2);
      canvas.width = sourceSize;
      canvas.height = sourceSize;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, sourceSize, sourceSize);
      const imageData = context.getImageData(0, 0, sourceSize, sourceSize);
      const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });

      if (result?.data) {
        const code = extractQrCode(result.data);
        // A decoded-but-unrecognized QR (someone's WiFi QR, a business card, etc.) is ignored
        // rather than surfaced as an error — keep scanning silently rather than interrupting
        // the camera view for every non-Solarium code that drifts into frame.
        if (code) {
          detectedRef.current = true;
          stopCamera();
          if (navigator.vibrate) navigator.vibrate(100);
          onDetected(code);
          return;
        }
      }
      frameRef.current = requestAnimationFrame(scanFrame);
    }

    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitCode(rawValue) {
    if (detectedRef.current) return;
    const code = extractQrCode(rawValue);
    if (!code) {
      setManualError('Enter a valid Solarium QR code or link, e.g. V-0001.');
      return;
    }
    setManualError('');
    detectedRef.current = true;
    scanningRef.current = false;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    onDetected(code);
  }

  return (
    <div className="qr-scanner-overlay" role="dialog" aria-label="Scan QR code">
      <div className="qr-scanner-panel">
        <div className="qr-scanner-header">
          <span>Scan QR code</span>
          <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="Close scanner">×</button>
        </div>
        {cameraError ? (
          <div className="qr-scanner-error">
            <p>{cameraError}</p>
          </div>
        ) : (
          <div className="qr-scanner-video-wrap">
            <video ref={videoRef} className="qr-scanner-video" muted playsInline />
            <div className="qr-scanner-frame">
              <span className="qr-scanner-corner top-left" />
              <span className="qr-scanner-corner top-right" />
              <span className="qr-scanner-corner bottom-left" />
              <span className="qr-scanner-corner bottom-right" />
            </div>
            {starting && <div className="qr-scanner-loading">Starting camera...</div>}
          </div>
        )}
        <form
          className="qr-scanner-manual-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitCode(manualCode);
          }}
        >
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck="false"
            placeholder="Paste QR link or enter code (e.g. V-0001)"
            value={manualCode}
            onChange={(event) => {
              setManualCode(event.target.value);
              if (manualError) setManualError('');
            }}
            onPaste={(event) => {
              // iOS/Android both support a normal user-initiated paste into a text input —
              // don't rely on programmatic clipboard reads (iOS restricts those), just react
              // to the paste event on this field and auto-submit if it parses cleanly.
              const pasted = event.clipboardData?.getData('text') || '';
              if (!pasted) return;
              event.preventDefault();
              setManualCode(pasted);
              submitCode(pasted);
            }}
            autoFocus={Boolean(cameraError)}
          />
          <button type="submit" disabled={!manualCode.trim()}>
            Use this code
          </button>
        </form>
        {manualError && <p className="qr-scanner-manual-error">{manualError}</p>}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <p className="qr-scanner-hint">Point the camera at the printed QR code, or paste its link/code above.</p>
      </div>
    </div>
  );
}

export default QrScanner;
