import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export default function QRCodeImage({ value, size = 80 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {});
  }, [value, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} />;
}
