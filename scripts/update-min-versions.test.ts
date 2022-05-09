import { promises as fsp } from 'fs';

import updateMinVersions from './update-min-versions';
import { getPackages, Package } from '@manypkg/get-packages';

let mockGit: any = {};

jest.mock('@manypkg/get-packages', () => ({
  getPackages: jest.fn(),
}));

jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
  },
}));
jest.mock('./write-release-info', () => ({
  metadataFilename: 'foo',
}));
jest.mock('simple-git', () => ({
  __esModule: true,
  default: () => mockGit,
}));

describe('update-min-versions', () => {
  let packages: Package[];
  let consoleLogSpy: jest.SpyInstance<
    ReturnType<Console['log']>,
    Parameters<Console['log']>
  >;
  beforeAll(() => {
    // Comment out the mockImplementation to read console.logs for debugging
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterAll(() => {
    consoleLogSpy.mockRestore();
  });
  beforeEach(async () => {
    mockGit = {
      add: jest.fn(),
      commit: jest.fn(),
    };
    packages = [
      {
        dir: 'foo/package-a',
        packageJson: {
          name: '@af/package-a',
          version: '1.0.0',
          private: true,
        },
      },
      {
        dir: 'foo/package-b',
        packageJson: {
          name: '@af/package-b',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@af/package-a': '^1.0.0',
          },
        },
      },
      {
        dir: 'foo/package-c',
        packageJson: {
          name: '@af/package-c',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@af/package-a': '^1.0.0',
            '@af/package-b': '^1.0.0',
          },
        },
      },
    ];
    (getPackages as jest.Mock).mockImplementation(() => ({ packages }));
    jest.clearAllMocks();
  });
  it('should update version ranges to latest minor release for unreleased dependents', async () => {
    expect(fsp.writeFile).not.toHaveBeenCalled();
    await updateMinVersions({
      changesets: [],
      preState: undefined,
      releases: [
        {
          name: '@af/package-a',
          oldVersion: '1.0.0',
          newVersion: '1.1.0',
          type: 'minor',
          changesets: [],
        },
      ],
    });

    expect(fsp.writeFile).toHaveBeenCalledTimes(2);
    expect(fsp.writeFile).toHaveBeenCalledWith(
      'foo/package-b/package.json',
      JSON.stringify(
        {
          name: '@af/package-b',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@af/package-a': '^1.1.0',
          },
        },
        null,
        2,
      ) + '\n',
    );
    expect(fsp.writeFile).toHaveBeenCalledWith(
      'foo/package-c/package.json',
      JSON.stringify(
        {
          name: '@af/package-c',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@af/package-a': '^1.1.0',
            '@af/package-b': '^1.0.0',
          },
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('should commit the version range update', async () => {
    expect(mockGit.add).not.toHaveBeenCalled();
    expect(mockGit.commit).not.toHaveBeenCalled();
    await updateMinVersions({
      changesets: [],
      preState: undefined,
      releases: [
        {
          name: '@af/package-a',
          oldVersion: '1.0.0',
          newVersion: '1.1.0',
          type: 'minor',
          changesets: [],
        },
      ],
    });
    expect(mockGit.add).toHaveBeenCalledWith(expect.arrayContaining(['-u']));
    expect(mockGit.commit).toHaveBeenCalledWith(
      expect.arrayContaining([
        'CI: Update version ranges of unreleased dependents',
        '[skip ci]',
      ]),
      expect.objectContaining({
        '--no-verify': null,
      }),
    );
    // package.jsons written before git add
    expect(
      (fsp.writeFile as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(mockGit.add.mock.invocationCallOrder[0]);
    // git add executed before git commit
    expect(mockGit.add.mock.invocationCallOrder[0]).toBeLessThan(
      mockGit.commit.mock.invocationCallOrder[0],
    );
  });

  it('should NOT update ranges for released dependents', async () => {
    await updateMinVersions({
      changesets: [],
      preState: undefined,
      releases: [
        {
          name: '@af/package-a',
          oldVersion: '1.0.0',
          newVersion: '1.1.0',
          type: 'minor',
          changesets: [],
        },
        {
          name: '@af/package-b',
          oldVersion: '1.0.0',
          newVersion: '1.0.1',
          type: 'patch',
          changesets: [],
        },
      ],
    });

    expect(fsp.writeFile).toHaveBeenCalledTimes(1);
    expect(fsp.writeFile).toHaveBeenCalledWith(
      'foo/package-c/package.json',
      JSON.stringify(
        {
          name: '@af/package-c',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@af/package-a': '^1.1.0',
            '@af/package-b': '^1.0.0',
          },
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('should NOT update ranges to latest patch release', async () => {
    await updateMinVersions({
      changesets: [],
      preState: undefined,
      releases: [
        {
          name: '@af/package-a',
          oldVersion: '1.0.0',
          newVersion: '1.0.1',
          type: 'patch',
          changesets: [],
        },
      ],
    });
    expect(fsp.writeFile).not.toHaveBeenCalled();
    expect(mockGit.commit).not.toHaveBeenCalled();
  });

  it('should gracefully handle no releases', async () => {
    await updateMinVersions({
      changesets: [],
      preState: undefined,
      releases: [],
    });
    expect(fsp.writeFile).not.toHaveBeenCalled();
    expect(mockGit.commit).not.toHaveBeenCalled();
  });

  it('should update dependents of multiple minor releases', async () => {
    expect(fsp.writeFile).not.toHaveBeenCalled();
    await updateMinVersions({
      changesets: [],
      preState: undefined,
      releases: [
        {
          name: '@af/package-a',
          oldVersion: '1.0.0',
          newVersion: '1.1.0',
          type: 'minor',
          changesets: [],
        },
        {
          name: '@af/package-b',
          oldVersion: '1.0.0',
          newVersion: '1.1.0',
          type: 'minor',
          changesets: [],
        },
      ],
    });

    expect(fsp.writeFile).toHaveBeenCalledTimes(1);
    expect(fsp.writeFile).toHaveBeenCalledWith(
      'foo/package-c/package.json',
      JSON.stringify(
        {
          name: '@af/package-c',
          version: '1.0.0',
          private: true,
          dependencies: {
            '@af/package-a': '^1.1.0',
            '@af/package-b': '^1.1.0',
          },
        },
        null,
        2,
      ) + '\n',
    );
  });
});
