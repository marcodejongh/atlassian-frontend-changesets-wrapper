/** Wrapper around changesets to add extra functionality
 *
 * - Adds support for none changesets when a change doesn't require a package to be released (triggered with --none)
 * - Asks an additional question regarding the type of change and tags the changeset summary
 */
import spawn from 'spawndamnit';
import chalk from 'chalk';
import { getPackages, Package } from '@manypkg/get-packages';
import { askQuestions, createNonePackagesQuestion } from '../lib/questions';
import {
  commitChangesetUpdate,
  commitNoneChangeset,
  getChangedPackages,
} from '../lib/git';
import {
  addChangesetTag,
  parseChangesetOutput,
  ChangesetOutput,
  updateChangesetBaseBranch,
  revertChangesetBaseBranch,
  addBaseBranchSinceFlag,
  writeNoneChangeset,
} from '../lib/changeset';

type PrePayload = {
  answers: {
    isUx?: boolean;
  };
  newArgs: string[];
  configChanged: boolean;
};

const EMPTY_CHANGESET_WARNING = chalk`
{red Empty changesets are not required anymore, instead we now check for changes that must have a changeset.}

{bold Does your change not need to be released? Either:}
  {blue 1. [PREFERRED]} Create a none changeset for the package(s) with {yellow "yarn changeset --none"}
  2. Opt-out entirely using the {yellow "no-changeset/"} branch prefix
`;

function isAddCmd(args: string[]) {
  return args.length === 0 || args[0] === 'add';
}

function isStatusCmd(args: string[]) {
  return args[0] === 'status';
}

async function pre(args: string[], rootDir: string): Promise<PrePayload> {
  let payload = {
    answers: {},
    newArgs: args,
    configChanged: false,
  };

  if (isStatusCmd(args)) {
    payload.newArgs = await addBaseBranchSinceFlag(payload.newArgs);
  }

  if (!isAddCmd(args)) {
    return payload;
  }

  // Ask any questions
  payload.answers = await askQuestions();

  // Update the .changeset/config.json to reflect true base branch
  // Fixes changed packages detection, must be changed back to origin/develop after command
  payload.configChanged = await updateChangesetBaseBranch(rootDir);

  return payload;
}

async function handleExceptionArgs(
  args: string[],
  cwd: string,
  packages: Package[],
) {
  if (args.includes('--empty')) {
    console.error(EMPTY_CHANGESET_WARNING);
  }

  if (args.includes('--none')) {
    const changedPackages = await getChangedPackages(cwd);
    const askNonePackagesQuestion = await createNonePackagesQuestion(
      changedPackages,
      packages,
    );
    let nonePackages = await askNonePackagesQuestion();
    while (nonePackages.length === 0) {
      console.error(
        chalk.red(
          'You must select at least one package to create a none changeset for.',
        ),
      );
      nonePackages = await askNonePackagesQuestion();
    }
    const changesetID = await writeNoneChangeset(nonePackages, cwd);
    await commitNoneChangeset(changesetID, { cwd });
    console.log(chalk.green('None Changeset added and committed'));
    return true;
  }

  return false;
}

async function post(
  args: string[],
  prePayload: PrePayload,
  changesetOutput: ChangesetOutput,
  cwd: string,
) {
  if (!isAddCmd(args)) {
    return;
  }
  const {
    answers: { isUx },
  } = prePayload;

  if (isUx) {
    console.log('Updating changeset with ux tag...');
    if (!changesetOutput.filepath) {
      throw new Error('Cannot find changeset file in changeset output');
    }
    try {
      await addChangesetTag(changesetOutput.filepath, 'ux');
    } catch (e) {
      console.error('Failed to add [ux] tag to changeset');
      throw e;
    }
    if (changesetOutput.committed) {
      await commitChangesetUpdate(changesetOutput.filepath, { cwd });
    }
    console.log('Done');
  }
}

export async function main(args: string[] = []) {
  const cwd = process.env.CWD || process.cwd();
  const { root, packages } = await getPackages(cwd);

  if (await handleExceptionArgs(args, root.dir, packages)) {
    return;
  }

  const prePayload = await pre(args, root.dir);

  const changesetProcess = spawn('changeset', prePayload.newArgs, {
    cwd: root.dir,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  // @ts-ignore event emitter types don't exist on spawned process
  changesetProcess.on('stdout', data => {
    process.stdout.write(data);
  });
  // @ts-ignore event emitter types don't exist on spawned process
  changesetProcess.on('stderr', data => {
    process.stderr.write(data);
  });
  let changesetResult: spawn.Result;
  try {
    changesetResult = await changesetProcess;
  } catch (e) {
    if (!e.code) {
      // The error object should be a spawn.Result with a non-zero exit code, re-throw if not
      throw e;
    }
    changesetResult = e;
  }
  if (prePayload.configChanged) {
    await revertChangesetBaseBranch(root.dir);
  }
  if (changesetResult.code !== 0) {
    process.exit(changesetResult.code);
  }
  const parsedChangesetOutput = parseChangesetOutput(
    changesetResult.stdout.toString(),
  );
  if (parsedChangesetOutput.cancelled) {
    process.exit();
  }
  await post(args, prePayload, parsedChangesetOutput, cwd);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
