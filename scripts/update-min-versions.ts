/**
 * Updates dependency version ranges of packages being released to prevent
 * stale version ranges where a package relies on features of a dependency
 * introduced in a version later than the minimum version.
 * Implemented outcome of https://hello.atlassian.net/wiki/spaces/AFP/pages/1272261739/Monorepo+DACI+001+Preventing+stale+minimum+version+dependency+ranges
 *
 * Dependency version ranges declared by a package, foo, will be updated when the following conditions are met:
 *  1. A dependency of foo will be 'minor' version released.
 *  2. The package foo will not be released.
 *     I.e., it is not marked for release and won't automatically be released by a dependency being bumped
 *
 * Dependency version ranges are already automatically updated by changesets if a dependent and its dependency
 * are released together, so we only need to handle the cases where the dependent is not released with the dependency.
 * Major releases of a dependency will always release dependents alongside it due to the new major version falling out of
 * the dependency version range declared by the dependent. Therefore we don't need to handle major releases.
 *
 * We don't bump dependency version ranges of patch releases for a few reasons:
 * 1. To minimise upgrade surface area & duplication so that the latest patch release of a transitive dependency doesn't always
 *    have to be upgraded to the latest. This can be a blocker for platform components that want to perform a targeted upgrade of
 *    a component outside of the bulk scheduled release process.
 * 2. If we released the dependents alongside their minimum version range bumps, it would cause the entire set of transitive dependents
 *    of a package to be released. This is because the minimum version range bumps of a dependent would be a patch release which would then
 *    cause its dependents to be bumped and so on. *Note* that we don't release dependents in this way currently so this isn't relevant right now.
 * 3. New features or API shouldn't be added in patch releases, so the likelihood of depending on a new feature added in a patch release is low.
 *
 * We explicitly choose not to release the dependents after updating their version ranges in order to reduce the number of unnecessary versions
 * being released. Unchanged dependents don't need to immediately depend on the latest minor version of a dependency, it is only until the next
 * actual change to the component that there is the possibility of relying on new functionality of a dependency. Therefore, we only bump the version
 * range without releasing. The version range update will be released alongside the next actual release of that package.
 */
import fs, { promises as fsp } from 'fs';
import path from 'path';

import { getPackages, Package } from '@manypkg/get-packages';
import { metadataFilename } from './write-release-info';
import { ReleasePlan, ComprehensiveRelease } from '@changesets/types';
import simpleGit from 'simple-git';

const dependencyTypes = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const;

type Dependency = {
  name: string;
  versionRange: string;
  depType: typeof dependencyTypes[number];
};

function assert(condition: any, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

function getDependentsGraph(packages: Package[]) {
  const graph = new Map<string, Dependency[]>();
  for (const pkg of packages) {
    const pkgName = pkg.packageJson.name;
    for (const depType of dependencyTypes) {
      const dependencies = pkg.packageJson[depType];
      const deps = Object.entries(dependencies || {});
      for (const [depName, versionRange] of deps) {
        const dependents = graph.get(depName) || [];
        dependents.push({ name: pkgName, versionRange, depType });
        graph.set(depName, dependents);
      }
    }
  }

  return graph;
}

function updateDependents(
  release: ComprehensiveRelease,
  dependents: Dependency[],
  packagesByName: Map<string, Package>,
  releasesByName: Map<string, ComprehensiveRelease>,
) {
  const updatedDependents = [];
  for (const dep of dependents) {
    /* Only update dependents that won't be released. Dependents that are released will have their version ranges
     * updated automatically by changesets itself */
    const existingRelease = releasesByName.get(dep.name);
    if (
      !existingRelease ||
      existingRelease.oldVersion === existingRelease.newVersion
    ) {
      if (!dep.versionRange.startsWith('^')) {
        /* Pinned versions and tilde ranges will always fall out of range with a minor release and be bumped by changesets
         * so this check only excludes other ranges such as >=, <=, || which are too edge casey to warrant support. */
        console.warn(
          `${release.name} has non-caret range version range of ${dep.name} dependency "${dep.versionRange}". Not updating minimum version."`,
        );
        continue;
      }
      const dependentPkg = packagesByName.get(dep.name);
      if (!dependentPkg) {
        throw new Error(`Cannot find package: ${dep}`);
      }
      const dependentDeps = dependentPkg.packageJson[dep.depType];
      assert(dependentDeps != null, `Missing ${dep.depType} in ${dep.name}`);
      console.log(
        `Updating ${dep.name}'s dependency version of ${release.name} to ^${release.newVersion}'`,
      );
      dependentDeps[release.name] = `^${release.newVersion}`;
      updatedDependents.push(dependentPkg);
    }
  }
  return updatedDependents;
}

export default async function main(
  releasePlan: ReleasePlan,
  cwd: string = process.cwd(),
) {
  const { packages } = await getPackages(cwd);
  const dependentsGraph = getDependentsGraph(packages);
  const packagesByName = new Map(packages.map(x => [x.packageJson.name, x]));
  const releasesByName = new Map(releasePlan.releases.map(x => [x.name, x]));

  const updatedDependents: Set<Package> = new Set();

  for (const release of releasePlan.releases) {
    if (release.type === 'minor') {
      const dependents = dependentsGraph.get(release.name);
      if (!dependents) {
        console.error(
          `Cannot find package marked for release: ${release.name}`,
        );
        continue;
      }
      updateDependents(
        release,
        dependents,
        packagesByName,
        releasesByName,
      ).forEach(dep => updatedDependents.add(dep));
    }
  }

  await Promise.all(
    [...updatedDependents].map(pkg =>
      // Refetch package.jsons
      fsp.writeFile(
        path.join(pkg.dir, 'package.json'),
        JSON.stringify(pkg.packageJson, null, 2) + '\n',
      ),
    ),
  );

  console.log(
    `Updated version ranges of ${updatedDependents.size} unreleased dependents`,
  );

  if (updatedDependents.size > 0) {
    const git = simpleGit(process.cwd());
    await git.add(['-u']);
    await git.commit(
      ['CI: Update version ranges of unreleased dependents', '[skip ci]'],
      {
        '--no-verify': null,
      },
    );
  }
}

if (require.main === module) {
  /* This script is executed _after_ changesets are removed by `changeset version`. As a result, we need to read
   * the release info that we wrote to disk before `changeset version` is run rather than fetching it programatically
   * from changesets itself.
   */
  const { releasePlan } = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), metadataFilename), 'utf8'),
  ) as { packages: Package[]; releasePlan: ReleasePlan };

  main(releasePlan).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
