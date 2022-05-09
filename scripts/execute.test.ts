import { copyFixtureIntoTempDir, cleanupTempDirs } from 'jest-fixtures';
// import { copyFixtureIntoTempDir } from 'jest-fixtures';
import outdent from 'outdent';
import simpleGit from 'simple-git';

import { testCli, DOWN, ENTER, SPACE, Input } from '../lib/test-cli';

// afterAll is placed outside the describe so that errors are not hidden, see https://github.com/facebook/jest/issues/9882
afterAll(() => {
  cleanupTempDirs();
});

function run(tempDir: string, input: Input[], args: string[] = []) {
  return testCli(['yarn', 'execute', ...args], input, {
    spawnOpts: {
      cwd: __dirname,
      env: { ...process.env, CWD: tempDir },
    },
    timeout: 0,
  });
}

async function assertLastCommitMessage(tempDir: string, message: string) {
  const git = simpleGit(tempDir);
  const lastCommit = await git.log(['-1']);
  expect(lastCommit.latest).toBeDefined();
  expect(lastCommit.latest?.message).toEqual(message);
}

async function assertChangesetContents(
  tempDir: string,
  contents: string,
  inverse = false,
) {
  const git = simpleGit(tempDir);
  const diff = await git.show();
  const expectDiff = inverse ? expect(diff).not : expect(diff);
  expectDiff.toEqual(
    expect.stringMatching(/--- \/dev\/null\n\+\+\+ b\/.changeset\/.*.md/),
  );
  expectDiff.toEqual(expect.stringContaining(contents));
}

async function initRepo(tempDir: string) {
  const git = simpleGit(tempDir);
  await git.init();
  await git.commit('first commit', {
    '--allow-empty': null,
  });
}

describe.skip('Execute', () => {
  let tempDir: string;
  const uxChangeString = 'Is this a UX change?';
  beforeEach(async () => {
    tempDir = await copyFixtureIntoTempDir(__dirname, 'simple-repo');
    await initRepo(tempDir);
    jest.clearAllMocks();
  });

  it('should successfully create a changeset', async () => {
    const result = await run(tempDir, [
      ['Is this a UX change', ENTER], // Default no UX change
      ['like to include', DOWN],
      SPACE,
      ENTER, // Select first package to bump
      ['major bump', ENTER], // No major
      ['minor bump', ENTER], // No minor
      ['enter a summary', 'added feature X'],
      ENTER, // Patch changelog message
      ['desired changeset', ENTER], // Confirmation
    ]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    expect(result.stdout).toEqual(expect.stringContaining(uxChangeString));

    await assertLastCommitMessage(tempDir, 'docs(changeset): added feature X');
    await assertChangesetContents(
      tempDir,
      outdent`
        +---
        +"@af/package-a": patch
        +---
        +
        +added feature X`,
    );
  });

  it('should prepend a ux tag when ux question is answered affirmatively', async () => {
    const result = await run(tempDir, [
      ['Is this a UX change', 'y'], // UX change
      ['like to include', DOWN],
      SPACE,
      ENTER, // Select first package to bump
      ['major bump', ENTER], // No major
      ['minor bump', ENTER], // No minor
      ['enter a summary', 'made ux change'],
      ENTER, // Patch changelog message
      ['desired changeset', ENTER], // Confirmation
    ]);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    await assertLastCommitMessage(tempDir, 'docs(changeset): made ux change');
    await assertChangesetContents(
      tempDir,
      outdent`
        +---
        +"@af/package-a": patch
        +---
        +
        +[ux] made ux change`,
    );
  });

  it('should not prepend ux tag when ux question is answered negatively', async () => {
    const result = await run(tempDir, [
      ['Is this a UX change', 'n'], // Default no UX change
      ['like to include', DOWN],
      SPACE,
      ENTER, // Select first package to bump
      ['major bump', ENTER], // No major
      ['minor bump', ENTER], // No minor
      ['enter a summary', 'tests'],
      ENTER, // Patch changelog message
      ['desired changeset', ENTER], // Confirmation
    ]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    await assertLastCommitMessage(tempDir, 'docs(changeset): tests');
    await assertChangesetContents(
      tempDir,
      outdent`
        +---
        +"@af/package-a": patch
        +---
        +
        +tests`,
    );
  });

  it('should not ask ux question when running other changeset commands', async () => {
    const result = await run(tempDir, [], ['version']);
    expect(result.code).toBe(0);

    expect(result.stdout).not.toEqual(expect.stringContaining(uxChangeString));
    expect(result.stderr).toEqual(
      expect.stringContaining('No unreleased changesets found, exiting.'),
    );
  });

  it('should not commit result if the new changeset was not committed', async () => {
    tempDir = await copyFixtureIntoTempDir(
      __dirname,
      'simple-repo-without-commit',
    );
    await initRepo(tempDir);

    await assertLastCommitMessage(tempDir, 'first commit');

    const result = await run(tempDir, [
      ['Is this a UX change', ENTER], // Default no UX change
      ['like to include', DOWN],
      SPACE,
      ENTER, // Select first package to bump
      ['major bump', ENTER], // No major
      ['minor bump', ENTER], // No minor
      ['enter a summary', 'added feature X'],
      ENTER, // Patch changelog message
      ['desired changeset', ENTER], // Confirmation
    ]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    await assertLastCommitMessage(tempDir, 'first commit');

    // Assert that this does _not_ show up in the first commit diff as a result of an amend
    await assertChangesetContents(
      tempDir,
      outdent`
        +---
        +"@af/package-a": patch
        +---
        +
        +added feature X`,
      true,
    );
  });

  it('should not prompt UX question when running changeset:empty', async () => {
    const result = await run(tempDir, [], ['--empty']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    expect(result.stdout).not.toEqual(expect.stringContaining(uxChangeString));
    expect(result.stdout).toEqual(expect.stringContaining('Empty Changeset'));
  });

  it('should successfully create a none changeset when running changeset --none', async () => {
    const result = await run(
      tempDir,
      [['like to include', SPACE], ENTER],
      ['--none'],
    );

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    await assertLastCommitMessage(tempDir, 'docs(changeset):');
    await assertChangesetContents(
      tempDir,
      outdent`
        +---
        +"@af/package-a": none
        +"@af/package-b": none
        +---
        +
        +This changeset exists because a PR touches these packages in a way that doesn't require a release
    `,
    );
  });

  // it('should exit gracefully if process is cancelled with ctrl-C', async () => {});
});
