import path from 'path';
import simpleGit from 'simple-git';
import { getChangedPackagesSinceRef } from '@changesets/git';
import { getBaseBranch as getBaseBranchUtil } from '@af/build-utils/git';

export async function commitChangesetUpdate(
  filepath: string,
  opts: { cwd: string },
) {
  const git = simpleGit(opts.cwd);

  await git.add(filepath);
  // -C HEAD re-uses existing commit message without invoking the editor
  await git.raw(['commit', '--amend', '-C', 'HEAD']);
}

export async function commitNoneChangeset(
  changesetID: string,
  opts: { cwd: string },
) {
  const git = simpleGit(opts.cwd);

  await git.add(path.join('.changeset', `${changesetID}.md`));
  await git.commit('docs(changeset):');
}

export function getBaseBranch() {
  // We no longer fetch origin in order to make the command faster.
  return getBaseBranchUtil('HEAD', {}, true);
}

export async function getChangedPackages(cwd: string) {
  const baseBranch = await getBaseBranch();
  const changedPackages = await getChangedPackagesSinceRef({
    cwd,
    ref: baseBranch,
  });
  return changedPackages.map(pkg => pkg.packageJson.name);
}
