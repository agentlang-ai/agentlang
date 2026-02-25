/**
 * Excel file resolver - query and create rows in Excel sheets.
 * Used by entities created from Excel config (agentlang.excel).
 */
import { makeInstance, newInstanceAttributes } from './module.js';
import { Instance } from './module.js';

function isUrl(path: string): boolean {
  return typeof path === 'string' && /^https?:\/\//i.test(path);
}

async function loadWorkbook(excelPath: string, XLSX: any): Promise<any> {
  if (isUrl(excelPath)) {
    const res = await fetch(excelPath);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    return XLSX.read(buf, { type: 'arraybuffer' });
  }
  return XLSX.readFile(excelPath);
}

export async function querySheet(
  _resolver: any,
  inst: Instance,
  _queryAll?: boolean
): Promise<Instance[]> {
  const filePath = inst.record.getMeta('excel_path');
  const sheetName = inst.record.getMeta('sheet_name');
  const excelHeaders: string[] | undefined = inst.record.getMeta('excel_headers');

  if (!filePath) {
    throw new Error('Excel file path is required for querying sheets');
  }

  const XLSXModule = await import('xlsx');
  const XLSX = (XLSXModule as any).default || XLSXModule;
  const workbook = await loadWorkbook(filePath, XLSX);
  const sheetNames = workbook.SheetNames || [];

  const targetSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const ws = workbook.Sheets[targetSheet];
  const rows = (XLSX.utils as any).sheet_to_json(ws, { raw: false, defval: null });

  const schema = inst.record.schema;
  const attrNames = Array.from(schema.keys()).filter(k => !k.startsWith('__') && k !== 'id');
  const headers = excelHeaders || attrNames;

  const result: Instance[] = [];
  for (const row of rows) {
    const attrs = newInstanceAttributes();
    for (let i = 0; i < attrNames.length; i++) {
      const attrName = attrNames[i];
      const headerKey = headers[i] ?? attrName;
      const val = (row as any)[headerKey];
      attrs.set(attrName, val === '' || val === null || val === undefined ? null : val);
    }
    const id = (row as any).id ?? `${filePath}|${targetSheet}|${Date.now()}-${Math.random()}`;
    attrs.set('id', id);
    result.push(makeInstance(inst.moduleName, inst.name, attrs));
  }
  return result;
}

export async function createSheetRow(_resolver: any, inst: Instance): Promise<Instance> {
  const meta = inst.record?.meta;
  if (!meta) {
    throw new Error('Meta with excel_path and sheet_name is required');
  }
  const filePath = meta.get('excel_path');
  if (!filePath) {
    throw new Error('excel_path is required in meta');
  }
  if (isUrl(filePath)) {
    throw new Error('createSheetRow requires a local file path; URLs are read-only');
  }

  const XLSXModule = await import('xlsx');
  const XLSX = (XLSXModule as any).default || XLSXModule;
  const workbook = (XLSX as any).readFile(filePath);
  const sheetName = meta.get('sheet_name') || workbook.SheetNames[0];

  const ws = workbook.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const headerRows = (XLSX.utils as any).sheet_to_json(ws, { header: 1 });
  const headers = (headerRows[0] || []) as string[];

  const row: Record<string, string> = {};
  inst.attributes.forEach((value, key) => {
    if (!key.startsWith('__')) {
      row[key] = value != null ? String(value) : '';
    }
  });

  (XLSX.utils as any).sheet_add_json(ws, [row], {
    skipHeader: true,
    header: headers.length ? headers : Object.keys(row),
    origin: -1,
  });

  (XLSX as any).writeFile(workbook, filePath);

  const created = newInstanceAttributes();
  inst.attributes.forEach((v, k) => {
    if (!k.startsWith('__')) created.set(k, v);
  });
  const id = inst.attributes.get('id') ?? `${filePath}|${sheetName}|${Date.now()}`;
  created.set('id', id);

  return makeInstance(inst.moduleName, inst.name, created);
}
