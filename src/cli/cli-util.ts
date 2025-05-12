import { path } from "../utils/runtime.js";

interface FilePathData {
  destination: string;
  name: string;
}

export function extractDestinationAndName(
  filePath: string,
  destination: string | undefined
): FilePathData {
  const fileName = path
    .basename(filePath, path.extname(filePath))
    .replace(/[.-]/g, "");

  return {
    destination: destination ?? path.join(path.dirname(filePath), "generated"),
    name: fileName,
  };
}
