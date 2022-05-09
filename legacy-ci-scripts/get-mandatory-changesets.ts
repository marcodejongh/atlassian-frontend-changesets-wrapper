import * as bolt from 'bolt';
import flattenDeep from 'lodash/flattenDeep';
import fs from 'fs';
// eslint-disable-next-line import/no-extraneous-dependencies
import glob from 'glob';
import path from 'path';

// @ts-ignore JS module import fails typecheck step
import git from './git';
import {
  AFPackageJson,
  AFPackageWithRelativeDir,
  PackagesWithChangedFiles,
} from './types';
import { isDefined } from './guards';

export async function getChangedPackagesWithChangedFiles(
  changedFiles: string[],
) {
  const project = await bolt.getProject();
  const projectDir = project.dir;
  const workspaces = await bolt.getWorkspaces<AFPackageJson>();
  // we'll add the relativeDir's to these so we have more information to work from later
  const allPackages = workspaces.map(pkg => ({
    ...pkg,
    relativeDir: path.relative(projectDir, pkg.dir),
  }));

  const fileNameToPackage = (fileName: string) =>
    allPackages.find(pkg => fileName.startsWith(pkg.dir + path.sep));

  const changedPackagesWithChangedFiles = changedFiles
    .filter(fileName => !fileName.endsWith('bundle-size-ratchet.json'))
    .filter(isDefined)
    .reduce((acc: PackagesWithChangedFiles, fileName: string) => {
      const correspondingPackage = fileNameToPackage(fileName);
      const packagename = correspondingPackage?.name;

      //make file relative to atlassian frontend root
      fileName = path.relative(projectDir, fileName);

      //create a mapping of packageName to changedFiles + other package info
      if (packagename && acc[packagename]) {
        acc[packagename].changedFiles.push(fileName);
      } else if (packagename && correspondingPackage) {
        acc[packagename] = {
          changedFiles: [fileName],
          ...correspondingPackage,
        };
      }
      return acc;
    }, {});
  //convert mapping to an array
  return Object.keys(changedPackagesWithChangedFiles).map(
    key => changedPackagesWithChangedFiles[key],
  );
}

export async function getChangedPackagesFromChangedFiles(
  changedFiles: string[],
) {
  const project = await bolt.getProject();
  const projectDir = project.dir;
  const workspaces = await bolt.getWorkspaces<AFPackageJson>();
  // we'll add the relativeDir's to these so we have more information to work from later
  const allPackages = workspaces.map(pkg => ({
    ...pkg,
    relativeDir: path.relative(projectDir, pkg.dir),
  }));

  const fileNameToPackage = (fileName: string) =>
    allPackages.find(pkg => fileName.startsWith(pkg.dir + path.sep));

  return (
    changedFiles
      .filter(fileName => !fileName.endsWith('bundle-size-ratchet.json'))
      .map(fileName => fileNameToPackage(fileName))
      .filter(isDefined)
      // filter, so that we have only unique packages
      .filter((pkg, idx, packages) => packages.indexOf(pkg) === idx)
  );
}

export async function getChangedPackagesSinceCommit(commit: string) {
  const changedFiles = await git.getChangedFilesSince(commit, true);
  return getChangedPackagesFromChangedFiles(changedFiles);
}

// Safe to use this one in master branch as it showing changes since some commit as opposed to a branch head.
export async function getChangedPackagesSincePublishCommit() {
  const lastRelease = await git.getLastPublishCommit();
  return getChangedPackagesSinceCommit(lastRelease);
}

// Note: This returns the packages that have changed AND been committed since master,
// it wont include staged/unstaged changes.
//
// Don't use this function in master branch as it returns nothing in that case.
export async function getChangedPackagesSinceBranch(branch: string) {
  const ref = await git.getRef(branch);
  return getChangedPackagesSinceCommit(ref);
}

/**
 * Returns a list of packages that have changed on `sourceBranch` compared to a base branch.
 * Base branch is calculated with the following priority:
 * - If `baseBranchOverride` is supplied, it is used.
 * - If `sourceBranch` is develop, a release-candidate or is not supplied, base branch is master
 * - If the base of `sourceBranch` is `develop`, base branch is develop
 * - Otherwise, base branch is master.
 */
export async function getChangedPackages(
  sourceBranch?: string,
  baseBranchOverride?: string,
) {
  // TODO: This is duplicated in scheduled-releases folder because it is using js for now. To remove when we move all build packages in TS.
  const ReleaseBranchPrefix = 'release-candidate/';
  const isReleaseBranch =
    sourceBranch && sourceBranch.startsWith(ReleaseBranchPrefix);

  const isDevelop = sourceBranch && sourceBranch === 'develop';

  // If there is no source branch, play it safe and set base branch to master to avoid incorrectly setting changed packages to
  // develop when running on a release/develop branch in an environment where source branch is not available, e.g. custom pipeline.
  // For an optimisation purpose, we first check if there is a `baseBranchOverride` if not we check the source branch or we get the base branch.
  let baseBranch;

  if (baseBranchOverride) {
    baseBranch = baseBranchOverride;
  } else {
    baseBranch =
      isReleaseBranch || isDevelop || !sourceBranch
        ? 'master'
        : await git.getBaseBranch();
  }

  return getChangedPackagesSinceBranch(baseBranch);
}

/**
 * This function extends `getChangedPackages` by returning a list of packages that have changed and the packages that dependent on them (dependents).
 * For now, we only add packages with `direct` dependency.
 */
export async function getChangedPackagesWithDependents(
  changedPackages: AFPackageWithRelativeDir[],
  dependentFlag: string,
) {
  const cwd = process.cwd();

  const allPackages = await bolt.getWorkspaces<AFPackageJson>({ cwd });

  let changedPackagesRelativePaths = changedPackages.map(
    pkg => pkg.relativeDir,
  );

  const dependencyGraph = await bolt.getDependentsGraph({ cwd });
  // 1. Match with changed packages.
  // 2. Get the package.json from those packages.
  // 3. Map and filter the changed packages with its own dependent packages.
  // 4. Based on the argument passed, it will return the direct dependencies.
  // 4. Return a flatten array of changed packages relative path.
  const getPackageJSON = (pkgName: string) =>
    allPackages.find(({ name }) => name === pkgName);
  const changedPackagesWithDependent = flattenDeep(
    changedPackages.map(({ name: changedPkgName }) => {
      const dependents = dependencyGraph.get(changedPkgName);
      if (!dependents) {
        throw new Error(`Cannot find dependents of '${changedPkgName}'`);
      }
      return dependents
        .filter(dependent => {
          const pkg = getPackageJSON(dependent);
          if (!pkg) {
            throw new Error(`Cannot find package '${dependent}'`);
          }
          const dependentPkgJSON = pkg.config;
          // --dependents='direct' flag will return packages with direct dependencies on the changed packages.
          // When a package does not have dependent or not required such as the build script.
          if (dependentFlag === 'direct') {
            return (
              dependentPkgJSON.dependencies &&
              dependentPkgJSON.dependencies[changedPkgName] !== undefined
            );
          }
          throw new Error(`The parsed flag is not recognised ${process.argv}`);
        })
        .map(pkg => (getPackageJSON(pkg) as bolt.Package<AFPackageJson>).dir)
        .map(pkg => path.relative(cwd, pkg));
    }),
  );
  // Set is used to avoid the case of multiple changed packages with the same dependent packages.
  changedPackagesRelativePaths = [
    ...new Set(
      changedPackagesRelativePaths.concat(changedPackagesWithDependent),
    ),
  ];
  return changedPackagesRelativePaths;
}

// This must be synchronous as it's used in the eslint config.
export function getPackagesOnScheduledReleasesEslint() {
  const allPackages = glob.sync('packages/*/*');
  return allPackages
    .filter(packagePath => {
      let packageJSON;
      try {
        packageJSON = JSON.parse(
          fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'),
        );
      } catch (e) {
        return false;
      }
      return (
        packageJSON.atlassian &&
        packageJSON.atlassian.releaseModel === 'scheduled'
      );
    })
    .map(dir => path.relative(process.cwd(), dir));
}

export function getPackagesOnContinuousReleasesEslint() {
  const allPackages = glob.sync('packages/*/*');

  return allPackages
    .filter(packagePath => {
      let packageJSON;
      try {
        packageJSON = JSON.parse(
          fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'),
        );
      } catch (e) {
        return false;
      }

      return (
        packageJSON.atlassian &&
        packageJSON.atlassian.releaseModel === 'continuous'
      );
    })
    .map(dir => path.relative(process.cwd(), dir));
}

export async function getPackagesOnScheduledReleases() {
  const packages = await bolt.getWorkspaces<AFPackageJson>();

  return packages.filter(
    pkg =>
      pkg.config.atlassian && pkg.config.atlassian.releaseModel === 'scheduled',
  );
}

export async function getPackagesOnContinuousReleases() {
  const packages = await bolt.getWorkspaces<AFPackageJson>();

  return packages.filter(
    pkg =>
      pkg.config.atlassian &&
      pkg.config.atlassian.releaseModel === 'continuous',
  );
}

export async function getTransitiveDependencies(
  pkgName: string,
  userOpts: {
    cwd?: string;
    depth?: number;
    excludedTypes?: bolt.ConfigDependencyType[];
    dependencyGraph?: bolt.Graph;
  },
) {
  const { cwd, depth, excludedTypes } = {
    cwd: process.cwd(),
    depth: -100,
    ...userOpts,
  };
  const depGraph =
    userOpts.dependencyGraph ||
    (await bolt.getDependencyGraph({ cwd, excludedTypes }));

  const visited = new Set<string>();
  const queue = [pkgName];
  let nodesUntilDepthIncrease = 1;
  let currentDepth = -1;

  while (queue.length) {
    nodesUntilDepthIncrease -= 1;
    if (nodesUntilDepthIncrease === 0) {
      currentDepth += 1;
      nodesUntilDepthIncrease = queue.length;
    }

    if (currentDepth === depth + 1) {
      break;
    }

    const currentPkg = queue.shift()!;
    if (visited.has(currentPkg)) {
      continue;
    }
    visited.add(currentPkg);

    const dependencies = depGraph.get(currentPkg);
    if (!dependencies) {
      throw new Error(`Cannot find '${currentPkg}' in dependency graph`);
    }
    queue.push(...dependencies);
  }

  visited.delete(pkgName);
  return Array.from(visited);
}

export async function getChangedPackagesWithMandatoryChangesetSinceCommit(
  commit: string,
) {
  const changedFiles = (await git.getChangedFilesSince(commit, true)).filter(
    (changedFile: string) => {
      const definitelyNeedChangeset = ['package.json', 'tsconfig.json'];

      const isTestFileRegex = new RegExp('.*.(examples|test).(ts|js)x?$');
      const isInSrcFileRegex = new RegExp('^.*/src/.*');
      const isInTestDirRegex = new RegExp('^.*/src/.*__tests__.*');

      if (
        changedFile.match(isInTestDirRegex) ||
        changedFile.match(isTestFileRegex)
      ) {
        return false;
      }

      if (
        !!definitelyNeedChangeset.find(pattern =>
          changedFile.endsWith(pattern),
        ) ||
        changedFile.match(isInSrcFileRegex)
      ) {
        return true;
      }

      return false;
    },
  );

  return getChangedPackagesFromChangedFiles(changedFiles);
}
