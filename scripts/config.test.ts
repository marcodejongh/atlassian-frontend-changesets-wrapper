import { promises as fsp } from 'fs';
import path from 'path';

import { ChangesetConfig } from './../lib/changeset';

// This test will prevent to commit manual changes to the `.changeset/config.json` file.
// For further context, see https://product-fabric.atlassian.net/browse/AFP-3369.
describe('Changeset configuration content', () => {
  let changesetConfigContent: ChangesetConfig = {
    $schema: '',
    changelog: '',
    commit: false,
    access: '',
    baseBranch: '',
    updateInternalDependencies: '',
  };

  beforeAll(async () => {
    changesetConfigContent = JSON.parse(
      await fsp.readFile(
        path.join(process.cwd(), '.changeset/config.json'),
        'utf8',
      ),
    );
  });

  it('"$schema" property should not be modified', async () => {
    const { $schema } = changesetConfigContent;
    expect($schema).toBe(
      'https://unpkg.com/@changesets/config@0.3.0/schema.json',
    );
  });

  it('"changelog" property should not be modified', async () => {
    const { changelog } = changesetConfigContent;
    expect(changelog).toBe('./changelogFunctions.js');
  });

  it('"commit" property should not be modified', async () => {
    const { commit } = changesetConfigContent;
    expect(commit).toBe(true);
  });

  it('"access" property should not be modified', async () => {
    const { access } = changesetConfigContent;
    expect(access).toBe('public');
  });

  it('"baseBranch" property should not be modified', async () => {
    const { baseBranch } = changesetConfigContent;
    expect(baseBranch).toBe('origin/develop');
  });
  it('"updateInternalDependencies" property should not be modified', async () => {
    const { updateInternalDependencies } = changesetConfigContent;
    expect(updateInternalDependencies).toBe('minor');
  });
});
