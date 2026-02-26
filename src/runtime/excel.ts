/**
 * Excel-based entity creation.
 * Reads Excel files specified in config and creates entities with columns as String @optional fields.
 * Each entity is connected to a file resolver that reads/writes the Excel file on demand (no data loading).
 */
import * as XLSX from 'xlsx';
import * as nodePath from 'node:path';
import { getFileSystem, readFileBuffer } from '../utils/fs-utils.js';
import { addModule, getEntity, isModule } from './module.js';
import { parseAndIntern } from './loader.js';
import { makeFqName } from './util.js';
import { logger } from './logger.js';

const ExcelModuleName = 'Excel';

export type ExcelConfigEntry = {
  url: string;
  sheet?: string;
  entityName?: string;
};

function toEntityName(filePath: string, explicitName?: string): string {
  let name: string;
  if (explicitName) {
    name = explicitName;
  } else {
    const base = nodePath.basename(filePath, nodePath.extname(filePath));
    // Strip multer-style suffix: basename-timestamp-random (e.g. Regions-1772039648356-726164924)
    const multerSuffix = /-\d{10,}-\d+$/;
    name = base.replace(multerSuffix, '') || base;
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }
  // Sanitize for valid identifier: only letters, digits, underscore (hyphens parse as minus)
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'Entity';
  return sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
}

function toAttrName(header: string): string {
  const s = header
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/^(\d)/, '_$1');
  return s || 'field';
}

export type CreateEntityFromExcelResult = {
  entityName: string;
  moduleName: string;
  fqName: string;
  headers: string[];
  sheetName: string;
  filePath: string;
};

/**
 * Create an entity and file resolver from an Excel file at the given path.
 * Used by config (processExcelConfig) and by the /excelUpload HTTP endpoint.
 */
export async function createEntityFromExcelFile(
  filePath: string,
  options?: { entityName?: string; sheetName?: string }
): Promise<CreateEntityFromExcelResult> {
  const buffer = await readFileBuffer(filePath);
  const workbook = (XLSX as any).read(buffer, { type: 'buffer' });

  const sheetName = options?.sheetName ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in ${filePath}`);
  }

  const rows = (XLSX.utils as any).sheet_to_json(sheet, { header: 1 });
  if (rows.length === 0) {
    throw new Error(`Sheet "${sheetName}" is empty in ${filePath}`);
  }

  const headers = (rows[0] as any[]).map((h: any) => String(h ?? '')).filter(Boolean);
  if (headers.length === 0) {
    throw new Error(`No headers found in sheet "${sheetName}" of ${filePath}`);
  }

  const entityName = toEntityName(filePath, options?.entityName);
  const attrSpecs = headers
    .map(h => toAttrName(String(h)))
    .filter(name => name !== 'id')
    .map(name => `${name} String @optional`);

  const entityDef = `entity ${entityName} {
  id String @id,
  ${attrSpecs.join(',\n  ')}
}`;

  if (!isModule(ExcelModuleName)) {
    addModule(ExcelModuleName);
  }

  await parseAndIntern(entityDef, ExcelModuleName);
  const entity = getEntity(entityName, ExcelModuleName);
  if (entity) {
    entity.addMeta('excel_path', nodePath.resolve(filePath));
    entity.addMeta('sheet_name', sheetName);
    entity.addMeta('excel_headers', headers);
  }
  const fqName = makeFqName(ExcelModuleName, entityName);

  const [{ GenericResolver }, { querySheet, createSheetRow }, { registerResolver, setResolver }] =
    await Promise.all([
      import('./resolvers/interface.js'),
      import('./excel-resolver.js'),
      import('./resolvers/registry.js'),
    ]);
  const resolverName = `excel/${entityName}`;
  const resolver = new GenericResolver(resolverName, {
    query: querySheet,
    create: createSheetRow,
    upsert: undefined,
    update: undefined,
    delete: undefined,
    startTransaction: undefined,
    commitTransaction: undefined,
    rollbackTransaction: undefined,
  });
  registerResolver(resolverName, () => resolver);
  setResolver(fqName, resolverName);

  logger.info(`Created entity ${fqName} from ${filePath} (file resolver)`);
  return {
    entityName,
    moduleName: ExcelModuleName,
    fqName,
    headers,
    sheetName,
    filePath: nodePath.resolve(filePath),
  };
}

export async function processExcelConfig(
  entries: ExcelConfigEntry[],
  basePath: string
): Promise<void> {
  if (!entries || entries.length === 0) return;

  const fs = await getFileSystem();

  for (const entry of entries) {
    const resolvedPath = nodePath.isAbsolute(entry.url)
      ? entry.url
      : nodePath.resolve(basePath, entry.url);

    if (!(await fs.exists(resolvedPath))) {
      logger.warn(`Excel file not found: ${resolvedPath}`);
      continue;
    }

    await createEntityFromExcelFile(resolvedPath, {
      entityName: entry.entityName,
      sheetName: entry.sheet,
    });
  }
}
