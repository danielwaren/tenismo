import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Carga .env si existe (Node 22 trae process.loadEnvFile). En GitHub Actions no
 * hay .env: las variables llegan del entorno y esta función no hace nada.
 */
export function loadEnv(root = process.cwd()): void {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    /* variables ya presentes en el entorno: se respetan */
  }
}
