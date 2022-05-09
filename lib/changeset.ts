import { promises as fsp } from 'fs';
import path from 'path';
import writeChangeset from '@changesets/write';

import { getBaseBranch } from './git';

export type ChangesetOutput = {
  filepath: string | null;
  committed: boolean;
  cancelled: boolean;
};

export type ChangesetConfig = {
  $schema: string;
  changelog: string;
  commit: boolean;
  access: string;
  baseBranch: string;
  updateInternalDependencies: string;
};

export async function addChangesetTag(filename: string, tag: string) {
  const fileContents = await fsp.readFile(filename, 'utf8');

  const lines = fileContents.split('\n');

  const summaryLineIdx = getSummaryLineIdx(lines);

  if (summaryLineIdx === -1) {
    throw new Error(`Could not find frontmatter and/or summary in ${filename}`);
  }

  lines[summaryLineIdx] = `[${tag}] ${lines[summaryLineIdx]}`;

  return fsp.writeFile(filename, lines.join('\n'));
}

function getSummaryLineIdx(lines: string[]) {
  const frontMatterEndIdx = lines.indexOf('---', 1);

  if (frontMatterEndIdx === -1) {
    return -1;
  }

  return lines.findIndex((val, idx) => idx > frontMatterEndIdx && val !== '');
}

export function parseChangesetOutput(changesetOutput: string): ChangesetOutput {
  const lines = changesetOutput.split('\n');
  return {
    filepath: getChangesetFilepath(lines),
    committed: didChangesetCommit(lines),
    cancelled: didChangesetCancel(lines),
  };
}

function didChangesetCancel(changesetLines: string[]) {
  const found = changesetLines.find(
    line =>
      line.includes('Cancelled... 👋') ||
      (line.includes('Is this your desired changeset') &&
        line.includes('false')),
  );

  return !!found;
}

function getChangesetFilepath(changesetLines: string[]) {
  const changesetFilepathLine = changesetLines.find(val =>
    /\/\.changeset\//.test(val),
  );

  if (!changesetFilepathLine) {
    return null;
  }

  const changesetLineParts = changesetFilepathLine.split(' ');

  return changesetLineParts[changesetLineParts.length - 1];
}

function didChangesetCommit(changesetLines: string[]) {
  const found = changesetLines.find(line =>
    line.includes('Changeset added and committed'),
  );

  return !!found;
}

export async function writeNoneChangeset(
  changedPackages: string[],
  cwd: string,
) {
  return writeChangeset(
    {
      summary:
        "This changeset exists because a PR touches these packages in a way that doesn't require a release",
      releases: changedPackages.map(pkg => ({ name: pkg, type: 'none' })),
    },
    cwd,
  );
}

export async function addBaseBranchSinceFlag(args: string[]) {
  if (args.some(arg => arg.startsWith('--since'))) {
    return args;
  }
  const baseBranch = await getBaseBranch();
  return [...args, `--since=${baseBranch}`];
}

export async function updateChangesetBaseBranch(rootDir: string) {
  const baseBranch = await getBaseBranch();
  if (baseBranch !== 'master') {
    return false;
  }
  const config = await getChangesetConfig(rootDir);
  await updateChangesetConfig(
    {
      ...config,
      baseBranch: 'origin/master',
    },
    rootDir,
  );
  return true;
}

export async function revertChangesetBaseBranch(rootDir: string) {
  const config = await getChangesetConfig(rootDir);
  await updateChangesetConfig(
    {
      ...config,
      baseBranch: 'origin/develop',
    },
    rootDir,
  );
}

async function getChangesetConfig(rootDir: string) {
  const configPath = path.join(rootDir, '.changeset', 'config.json');
  return JSON.parse(await fsp.readFile(configPath, 'utf-8')) as ChangesetConfig;
}

async function updateChangesetConfig(config: ChangesetConfig, rootDir: string) {
  const configPath = path.join(rootDir, '.changeset', 'config.json');
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}
