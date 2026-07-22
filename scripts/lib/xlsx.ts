/**
 * Lector mínimo de XLSX, suficiente para los ficheros de tennis-data.co.uk.
 *
 * Se evita una dependencia pesada de hojas de cálculo: un .xlsx es un ZIP con
 * XML dentro y solo hacemos falta leer una hoja plana sin fórmulas ni estilos.
 *
 * Dos trampas del formato que el parser SÍ maneja (y que un split ingenuo por
 * <c> se come):
 *   1. Las celdas VACÍAS no aparecen en el XML. Hay que colocar cada celda por
 *      la letra de su referencia (r="G12" → columna 6), nunca por su posición
 *      dentro de la fila, o las columnas se desplazan en cuanto falta una cuota.
 *   2. Las fechas son números de serie de Excel, no texto.
 */
import { Open } from 'unzipper';

export type Cell = string | number | null;
export type Row = Cell[];

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Número de serie de Excel → 'YYYY-MM-DD' (epoch 1899-12-30, con el bug de 1900). */
export function excelSerialToISO(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

async function entryText(directory: any, path: string): Promise<string | null> {
  const file = directory.files.find((f: any) => f.path === path);
  if (!file) return null;
  return (await file.buffer()).toString('utf8');
}

/**
 * Lee la primera hoja de un .xlsx y devuelve filas rectangulares (rellenando
 * los huecos con null). `dateHeaders` nombra las columnas de la fila de
 * cabecera cuyo contenido numérico debe leerse como fecha (serie de Excel).
 */
export async function readXlsx(
  filePath: string,
  opts: { dateHeaders?: string[] } = {},
): Promise<Row[]> {
  const directory = await Open.file(filePath);

  const sharedRaw = (await entryText(directory, 'xl/sharedStrings.xml')) ?? '';
  // Cada <si> puede contener varios <t> (texto con formato mixto): se concatenan.
  const shared = [...sharedRaw.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );

  const sheetPath =
    directory.files.find((f: any) => /^xl\/worksheets\/sheet1\.xml$/.test(f.path))?.path ??
    directory.files.find((f: any) => /^xl\/worksheets\/.*\.xml$/.test(f.path))?.path;
  if (!sheetPath) throw new Error(`Sin hoja legible en ${filePath}`);
  const sheet = (await entryText(directory, sheetPath))!;

  const rows: Row[] = [];

  for (const rowMatch of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Row = [];
    for (const c of rowMatch[1].matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>|<c\s+([^>]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? '';
      const body = c[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const idx = colIndex(ref);
      const type = /t="(\w+)"/.exec(attrs)?.[1];

      let value: Cell = null;
      if (type === 'inlineStr') {
        value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) {
          if (type === 's') value = shared[Number(v)] ?? null;
          else if (type === 'str' || type === 'e') value = decodeXml(v);
          else {
            const num = Number(v);
            value = Number.isNaN(num) ? decodeXml(v) : num;
          }
        }
      }
      while (cells.length < idx) cells.push(null);
      cells[idx] = value;
    }
    rows.push(cells);
  }

  // Normaliza el ancho de todas las filas al máximo encontrado.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of rows) while (r.length < width) r.push(null);

  // Fechas: se resuelven por NOMBRE de columna en la cabecera, porque la
  // posición cambia entre temporadas (las casas de apuestas de las últimas
  // columnas van y vienen).
  const wanted = new Set((opts.dateHeaders ?? []).map((h) => h.toLowerCase()));
  if (wanted.size && rows.length) {
    const dateCols = rows[0]
      .map((h, i) => (typeof h === 'string' && wanted.has(h.trim().toLowerCase()) ? i : -1))
      .filter((i) => i >= 0);
    for (let r = 1; r < rows.length; r++) {
      for (const c of dateCols) {
        const v = rows[r][c];
        if (typeof v === 'number') rows[r][c] = excelSerialToISO(v);
      }
    }
  }
  return rows;
}
