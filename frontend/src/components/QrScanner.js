import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Extracts the code from either a raw code ("V-0001") or a full scanned referral URL
// (".../v/V-0001") — physical QR codes encode the full URL, not the bare code.
export function extractQrCode(decodedText) {
  const trimmed = (decodedText || '').trim();
  const match = trimmed.match(/\/v\/([^/?#]+)\/?$/i);
  return match ? decodeURIComponent(match[1]) : trimmed;
}

function QrScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is not supported on this device/browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scanFrame();
      } catch (requestError) {
        setError('Camera permission was denied. Enter the code manually instead.');
      }
    }

    function scanFrame() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frameRef.current = requestAnimationFrame(scanFrame);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height);
      if (result?.data) {
        onDetected(extractQrCode(result.data));
        return;
      }
      frameRef.current = requestAnimationFrame(scanFrame);
    }

    start();
    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qr-scanner-overlay" role="dialog" aria-label="Scan QR code">
      <div className="qr-scanner-panel">
        <div className="qr-scanner-header">
          <span>Scan QR code</span>
          <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="Close scanner">×</button>
        </div>
        {error ? (
          <div className="qr-scanner-error">{error}</div>
        ) : (
          <div className="qr-scanner-video-wrap">
            <video ref={videoRef} className="qr-scanner-video" muted playsInline />
            <div className="qr-scanner-frame" />
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <p className="qr-scanner-hint">Point the camera at the printed QR code.</p>
      </div>
    </div>
  );
}

export default QrScanner;
