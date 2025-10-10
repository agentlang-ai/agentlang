import { Result, Environment, makeEventEvaluator } from '../interpreter.js';
import { makeCoreModuleName } from '../util.js';
import crypto from 'crypto';

export const CoreFilesModuleName = makeCoreModuleName('files');

export default `module ${CoreFilesModuleName}

entity File {
    id UUID @id @default(uuid()),
    filename String @unique @indexed,
    originalName String,
    mimetype String,
    size Int,
    uploadedBy String @optional,
    uploadedAt DateTime @default(now()),
    path String,
    @rbac [(roles: [*], allow: [create])
           (allow: [read, delete], where: auth.user = this.uploadedBy)]
}

workflow CreateFile {
  {File {id CreateFile.id,
         filename CreateFile.filename,
         originalName CreateFile.originalName,
         mimetype CreateFile.mimetype,
         size CreateFile.size,
         uploadedBy CreateFile.uploadedBy,
         uploadedAt CreateFile.uploadedAt,
         path CreateFile.path}}
}

workflow FindFile {
  {File {id? FindFile.id}} @as [file];
  file
}

workflow FindFileByFilename {
  {File {filename? FindFileByFilename.filename}} @as [file];
  file
}

workflow ListFiles {
  {File? {}}
}

workflow ListUserFiles {
  {File {uploadedBy? ListUserFiles.userId}}
}

workflow DeleteFile {
  delete {File {id? DeleteFile.id}}
}

workflow DeleteFileByFilename {
  delete {File {filename? DeleteFileByFilename.filename}}
}

workflow UpdateFile {
  {File {id? UpdateFile.id,
         originalName UpdateFile.originalName,
         mimetype UpdateFile.mimetype,
         size UpdateFile.size}}
}
`;

const evalEvent = makeEventEvaluator(CoreFilesModuleName);

export async function createFileRecord(
  fileInfo: {
    filename: string;
    originalName: string;
    mimetype: string;
    size: number;
    path: string;
    uploadedBy?: string;
  },
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'CreateFile',
    {
      id: crypto.randomUUID(),
      filename: fileInfo.filename,
      originalName: fileInfo.originalName,
      mimetype: fileInfo.mimetype,
      size: fileInfo.size,
      path: fileInfo.path,
      uploadedBy: fileInfo.uploadedBy || '',
      uploadedAt: new Date().toISOString(),
    },
    env
  );
}

export async function findFileByFilename(
  filename: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'FindFileByFilename',
    {
      filename: filename,
    },
    env
  );
}

export async function deleteFileRecord(
  filename: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'DeleteFileByFilename',
    {
      filename: filename,
    },
    env
  );
}

export async function listAllFiles(env: Environment): Promise<Result> {
  return await evalEvent('ListFiles', {}, env);
}

export async function listUserFiles(
  userId: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'ListUserFiles',
    {
      userId: userId,
    },
    env
  );
}

