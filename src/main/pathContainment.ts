import path from "path";

export function isPathContained(rootPath: string, candidatePath: string) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function filterContainedPaths(
  rootPath: string,
  candidatePaths: string[],
) {
  return candidatePaths.filter((candidatePath) =>
    isPathContained(rootPath, candidatePath),
  );
}
