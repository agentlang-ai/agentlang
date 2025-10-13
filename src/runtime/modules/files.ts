import { Result, Environment, evaluate } from '../interpreter.js';
import { makeCoreModuleName } from '../util.js';
import { Instance, makeInstance, objectAsInstanceAttributes } from '../module.js';
import crypto from 'crypto';
import { ActiveSessionInfo } from '../auth/defs.js';

export const CoreFilesModuleName = makeCoreModuleName('files');

export default `module ${CoreFilesModuleName}

entity File {
    id String @id,
    filename String @unique @indexed,
    originalName String @optional,
    mimetype String @default("application/octet-stream"),
    size Int @optional,
    uploadedBy String @optional,
    uploadedAt DateTime @default(now()),
    path String @optional,
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
         path CreateFile.path},
  @upsert}
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
    CoreFilesModuleName,
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
    CoreFilesModuleName,
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
    CoreFilesModuleName,
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
  let inst: Instance = makeInstance(
    CoreFilesModuleName,
    'ListFiles',
    objectAsInstanceAttributes({})
  );

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
    CoreFilesModuleName,
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
