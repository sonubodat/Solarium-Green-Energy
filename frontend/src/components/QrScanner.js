import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Extracts the code from either a raw code ("V-0001") or a full scanned referral URL
// (".../v/V-0001") — physical QR codes encode the full URL, not the bare code.
export function extractQrCode(decodedText) {
  const trimmed = (decodedText || '').trim();
  const match = trimmed.match(/\/v\/([^/?#]+)\/?$/i);
  return match ? decodeURIComponent(match[1]) : trimmed;
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
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is not supported in this browser. Enter the code manually instead.');
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
          setError(cameraErrorMessage(requestError));
          setStarting(false);
        }
      }
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
        if (code) {
          detectedRef.current = true;
          scanningRef.current = false;
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
      scanningRef.current = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitManualCode(event) {
    event.preventDefault();
    if (detectedRef.current) return;
    const code = extractQrCode(manualCode);
    if (!code) return;
    detectedRef.current = true;
    scanningRef.current = false;
    onDetected(code);
  }

  return (
    <div className="qr-scanner-overlay" role="dialog" aria-label="Scan QR code">
      <div className="qr-scanner-panel">
        <div className="qr-scanner-header">
          <span>Scan QR code</span>
          <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="Close scanner">×</button>
        </div>
        {error ? (
          <div className="qr-scanner-error">
            <p>{error}</p>
            <form className="qr-scanner-manual-form" onSubmit={submitManualCode}>
              <input
                type="text"
                placeholder="Enter QR code (e.g. V-0001)"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                autoFocus
              />
              <button type="submit" disabled={!manualCode.trim()}>
                Use this code
              </button>
            </form>
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
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <p className="qr-scanner-hint">Point the camera at the printed QR code.</p>
      </div>
    </div>
  );
}

export default QrScanner;
