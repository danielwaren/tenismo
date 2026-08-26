import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array } from './push-client';

describe('urlBase64ToUint8Array', () => {
  it('decodifica una clave VAPID real (65 bytes, punto EC sin comprimir) sin lanzar', () => {
    // Clave pública VAPID real generada para este proyecto — formato P-256 sin
    // comprimir: primer byte 0x04, luego 32+32 bytes de X/Y.
    const key = 'BNeWAFmnCFqrjwJ5BXX8DSIvk4DnPLdQOCv1KQwmOop3Yf-xUULTNR_bm5MSuMhqvz78aSGfL4RmS50-nq3AUUY';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('traduce "-" y "_" (base64url) a "+"/"/" (base64 estándar) antes de decodificar', () => {
    // "-" -> "+", "_" -> "/": sin la traducción, atob lanzaría o decodificaría mal.
    const withUrlChars = 'AA-_';
    expect(() => urlBase64ToUint8Array(withUrlChars)).not.toThrow();
  });

  it('rellena el padding "=" según la longitud, sin exigirlo en la entrada', () => {
    // Cadenas de longitud 4n+1 no existen en base64 válido; 4n, 4n+2 y 4n+3 sí.
    for (const s of ['AAAA', 'AAA', 'AA']) {
      expect(() => urlBase64ToUint8Array(s)).not.toThrow();
    }
  });
});
