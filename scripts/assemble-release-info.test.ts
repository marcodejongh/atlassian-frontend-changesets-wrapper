import { copyFixtureIntoTempDir, cleanupTempDirs } from 'jest-fixtures';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import spawn from 'spawndamnit';

// afterAll is placed outside the describe so that errors are not hidden, see https://github.com/facebook/jest/issues/9882
afterAll(() => {
  cleanupTempDirs();
});

async function initRepo(tempDir: string) {
  const git = simpleGit(tempDir);
  await git.init();
  await git.commit('first commit', {
    '--allow-empty': null,
  });
  // we symlink the root node modules to test the (possibly patched) version of changesets present at the root
  fs.symlinkSync(
    path.join(__dirname, '../../../../node_modules'),
    path.join(tempDir, 'node_modules'),
    'dir',
  );
}

async function executeYarnChangesetVersion(tempDir: string) {
  try {
    await spawn('yarn', ['execute', 'version'], {
      cwd: __dirname,
      env: { ...process.env, CWD: tempDir },
    });
  } catch (error) {
    console.log(error.stdout.toString());
    console.log(error.stderr.toString());
  }
}

async function parsePkgJson(
  tempDir: string,
  pkgName: string,
): Promise<{ [key: string]: any }> {
  return JSON.parse(
    fs.readFileSync(
      path.join(tempDir, 'packages', pkgName, 'package.json'),
      'utf8',
    ),
  );
}

describe('Assemble release info', () => {
  let tempDir: string;
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  it('should correctly update package version despite none changesets (processed first)', async () => {
    tempDir = await copyFixtureIntoTempDir(__dirname, 'repo-with-none-first');
    await initRepo(tempDir);
    await executeYarnChangesetVersion(tempDir);

    const pkgJsonA = await parsePkgJson(tempDir, 'package-a');
    const pkgJsonB = await parsePkgJson(tempDir, 'package-b');
    const pkgJsonC = await parsePkgJson(tempDir, 'package-c');
    expect(pkgJsonA.version).toEqual('0.0.2');
    expect(pkgJsonB.version).toEqual('0.1.0');
    expect(pkgJsonC.version).toEqual('1.0.0');
  });

  it('should correctly update package version despite none changesets (processed last)', async () => {
    tempDir = await copyFixtureIntoTempDir(__dirname, 'repo-with-none-last');
    await initRepo(tempDir);
    await executeYarnChangesetVersion(tempDir);

    const pkgJsonA = await parsePkgJson(tempDir, 'package-a');
    const pkgJsonB = await parsePkgJson(tempDir, 'package-b');
    const pkgJsonC = await parsePkgJson(tempDir, 'package-c');
    expect(pkgJsonA.version).toEqual('0.0.2');
    expect(pkgJsonB.version).toEqual('0.1.0');
    expect(pkgJsonC.version).toEqual('1.0.0');
  });
  it('should not update package version with none changesets', async () => {
    tempDir = await copyFixtureIntoTempDir(__dirname, 'repo-with-none-only');
    await initRepo(tempDir);
    await executeYarnChangesetVersion(tempDir);

    const pkgJsonA = await parsePkgJson(tempDir, 'package-a');
    const pkgJsonB = await parsePkgJson(tempDir, 'package-b');
    const pkgJsonC = await parsePkgJson(tempDir, 'package-c');
    expect(pkgJsonA.version).toEqual('0.0.1');
    expect(pkgJsonB.version).toEqual('0.0.1');
    expect(pkgJsonC.version).toEqual('0.0.1');
  });
});
