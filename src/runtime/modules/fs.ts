import { Result, Environment, evaluate } from '../interpreter.js';
import { makeCoreModuleName, DefaultFileHandlingDirectory } from '../util.js';
import { Instance, makeInstance, objectAsInstanceAttributes } from '../module.js';
import crypto from 'crypto';
import { ActiveSessionInfo } from '../auth/defs.js';
import { resolve, dirname, sep } from 'node:path';
import { getFileSystem } from '../../utils/fs-utils.js';

export const CoreFsModuleName = makeCoreModuleName('fs');

export default `module ${CoreFsModuleName}

import "./modules/fs.js" @as Fs

entity File {
    id String @id,
    filename String @unique @indexed,
    originalName String @optional,
    mimetype String @default("application/octet-stream"),
    size Int @optional,
    uploadedBy String @optional,
    uploadedAt DateTime @default(now()),
    path String @optional,
    @rbac [(roles: [admin], allow: [create, read, update, delete]),
           (allow: [create, read, update, delete], where: auth.user = this.uploadedBy)]
}

@public workflow CreateFile {
  {File {id CreateFile.id,
         filename CreateFile.filename,
         originalName CreateFile.originalName,
         mimetype CreateFile.mimetype,
         size CreateFile.size,
         uploadedBy CreateFile.uploadedBy,
         uploadedAt CreateFile.uploadedAt,
         path CreateFile.path},
  @upsert}
}

@public workflow FindFile {
  {File {id? FindFile.id}} @as [file];
  file
}

@public workflow FindFileByFilename {
  {File {filename? FindFileByFilename.filename}} @as [file];
  file
}

@public workflow ListFiles {
  {File? {}}
}

@public workflow ListUserFiles {
  {File {uploadedBy? ListUserFiles.userId}}
}

@public workflow DeleteFileById {
  delete {File {id? DeleteFileById.id}}
}

@public workflow DeleteFileByFilename {
  delete {File {filename? DeleteFileByFilename.filename}}
}

@public workflow UpdateFile {
  {File {id? UpdateFile.id,
         originalName UpdateFile.originalName,
         mimetype UpdateFile.mimetype,
         size UpdateFile.size}}
}

@public workflow ReadFile {
  {File {filename? ReadFile.filename}} @as [file];
  await Fs.readContent(file)
}

@public workflow WriteFile {
  {File {id WriteFile.id,
         filename WriteFile.filename,
         originalName WriteFile.originalName,
         mimetype WriteFile.mimetype,
         uploadedBy WriteFile.uploadedBy,
         path WriteFile.path},
  @upsert} @as file;
  await Fs.writeContent(file, WriteFile.content)
}

@public workflow DeleteFile {
  {File {filename? DeleteFile.filename}} @as [file];
  delete {File {filename? DeleteFile.filename}};
  await Fs.deleteContent(file)
}

@public workflow CreateFolder {
  await Fs.createFolder(CreateFolder.path)
}

@public workflow ListFolder {
  await Fs.listFolder(ListFolder.path)
}

@public workflow DeleteFolder {
  await Fs.deleteFolder(DeleteFolder.path, DeleteFolder.force)
}
`;

function getStorageRoot(): string {
  const envPath = process.env.AL_STORAGE_PATH;
  return envPath ? resolve(envPath) : resolve(process.cwd(), DefaultFileHandlingDirectory);
}

function validateAndResolvePath(filePath: string): string {
  const storageRoot = getStorageRoot();
  const resolved = resolve(storageRoot, filePath);
  if (!resolved.startsWith(storageRoot + sep) && resolved !== storageRoot) {
    throw new Error(`Path traversal denied: ${filePath}`);
  }
  return resolved;
}

function isTextMimetype(mimetype: string): boolean {
  return (
    mimetype.startsWith('text/') ||
    mimetype === 'application/json' ||
    mimetype === 'application/xml' ||
    mimetype === 'application/javascript' ||
    mimetype === 'application/typescript' ||
    mimetype === 'application/x-yaml' ||
    mimetype === 'application/yaml'
  );
}

export async function readContent(
  file: Instance | null | undefined,
  env: Environment
): Promise<Result> {
  if (!file) {
    throw new Error('File not found or access denied');
  }
  const filename = file.lookup('filename');
  const mimetype = file.lookup('mimetype') || 'application/octet-stream';
  const filePath = file.lookup('path') || filename;
  const resolved = validateAndResolvePath(filePath);
  const fs = await getFileSystem();
  if (isTextMimetype(mimetype)) {
    const content = await fs.readFile(resolved);
    return { filename, content, mimetype, encoding: 'text' };
  } else {
    const buffer = await fs.readFileBuffer(resolved);
    const content = buffer.toString('base64');
    return { filename, content, mimetype, encoding: 'base64' };
  }
}

export async function writeContent(
  file: Instance | null | undefined,
  content: string,
  env: Environment
): Promise<Result> {
  if (!file) {
    throw new Error('File not found or access denied');
  }
  const filename = file.lookup('filename');
  const mimetype = file.lookup('mimetype') || 'application/octet-stream';
  const filePath = file.lookup('path') || filename;
  const resolved = validateAndResolvePath(filePath);
  const fs = await getFileSystem();
  await fs.ensureDir(dirname(resolved));
  if (isTextMimetype(mimetype)) {
    await fs.writeFile(resolved, content);
  } else {
    const buffer = Buffer.from(content, 'base64');
    await fs.writeFile(resolved, buffer);
  }
  return { filename, mimetype, status: 'written' };
}

export async function deleteContent(
  file: Instance | null | undefined,
  env: Environment
): Promise<Result> {
  if (!file) {
    throw new Error('File not found or access denied');
  }
  const filename = file.lookup('filename');
  const filePath = file.lookup('path') || filename;
  const resolved = validateAndResolvePath(filePath);
  const fs = await getFileSystem();
  if (await fs.exists(resolved)) {
    await fs.unlink(resolved);
  }
  return { filename, status: 'deleted' };
}

export async function createFolder(folderPath: string, env: Environment): Promise<Result> {
  const resolved = validateAndResolvePath(folderPath);
  const fs = await getFileSystem();
  await fs.ensureDir(resolved);
  return { path: folderPath, status: 'created' };
}

export async function listFolder(folderPath: string, env: Environment): Promise<Result> {
  const resolved = validateAndResolvePath(folderPath);
  const fs = await getFileSystem();
  const entries = await fs.readdir(resolved);
  const results = [];
  for (const entry of entries) {
    const entryPath = resolve(resolved, entry);
    const stats = await fs.stat(entryPath);
    results.push({
      name: entry,
      type: stats.isDirectory() ? 'folder' : 'file',
      size: stats.size,
    });
  }
  return { path: folderPath, entries: results };
}

export async function deleteFolder(
  folderPath: string,
  force: boolean,
  env: Environment
): Promise<Result> {
  const resolved = validateAndResolvePath(folderPath);
  const fs = await getFileSystem();
  if (await fs.exists(resolved)) {
    if (force) {
      await fs.removeDir(resolved);
    } else {
      const entries = await fs.readdir(resolved);
      if (entries.length > 0) {
        throw new Error(
          `Folder is not empty: ${folderPath}. Use force to delete non-empty folders.`
        );
      }
      await fs.rmdir(resolved);
    }
  }
  return { path: folderPath, status: 'deleted' };
}

export async function createFileRecord(
  fileInfo: {
    filename: string;
    originalName: string;
    mimetype: string;
    size: number;
    path: string;
    uploadedBy?: string;
  },
  sessionInfo?: ActiveSessionInfo,
  callback?: (result: Result) => void,
  env?: Environment
): Promise<Result> {
  let inst: Instance = makeInstance(
    CoreFsModuleName,
    'CreateFile',
    objectAsInstanceAttributes({
      id: crypto.randomUUID(),
      filename: fileInfo.filename,
      originalName: fileInfo.originalName,
      mimetype: fileInfo.mimetype,
      size: fileInfo.size,
      path: fileInfo.path,
      uploadedBy: fileInfo.uploadedBy || '',
      uploadedAt: new Date().toISOString(),
    })
  );

  if (sessionInfo) {
    inst = inst.setAuthContext(sessionInfo);
  }

  return await evaluate(inst, callback, env);
}

export async function findFileByFilename(
  filename: string,
  sessionInfo?: ActiveSessionInfo,
  callback?: (result: Result) => void,
  env?: Environment
): Promise<Result> {
  let inst: Instance = makeInstance(
    CoreFsModuleName,
    'FindFileByFilename',
    objectAsInstanceAttributes({
      filename: filename,
    })
  );

  if (sessionInfo) {
    inst = inst.setAuthContext(sessionInfo);
  }

  return await evaluate(inst, callback, env);
}

export async function deleteFileRecord(
  filename: string,
  sessionInfo?: ActiveSessionInfo,
  callback?: (result: Result) => void,
  env?: Environment
): Promise<Result> {
  let inst: Instance = makeInstance(
    CoreFsModuleName,
    'DeleteFileByFilename',
    objectAsInstanceAttributes({
      filename: filename,
    })
  );

  if (sessionInfo) {
    inst = inst.setAuthContext(sessionInfo);
  }

  return await evaluate(inst, callback, env);
}

export async function listAllFiles(
  sessionInfo?: ActiveSessionInfo,
  callback?: (result: Result) => void,
  env?: Environment
): Promise<Result> {
  let inst: Instance = makeInstance(CoreFsModuleName, 'ListFiles', objectAsInstanceAttributes({}));

  if (sessionInfo) {
    inst = inst.setAuthContext(sessionInfo);
  }

  return await evaluate(inst, callback, env);
}

export async function listUserFiles(
  userId: string,
  sessionInfo?: ActiveSessionInfo,
  callback?: (result: Result) => void,
  env?: Environment
): Promise<Result> {
  let inst: Instance = makeInstance(
    CoreFsModuleName,
    'ListUserFiles',
    objectAsInstanceAttributes({
      userId: userId,
    })
  );

  if (sessionInfo) {
    inst = inst.setAuthContext(sessionInfo);
  }

  return await evaluate(inst, callback, env);
}
