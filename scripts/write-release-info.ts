import { promises as fsp } from 'fs';
import path from 'path';

import getReleasePlan from '@changesets/get-release-plan';
import { getPackages } from '@manypkg/get-packages';

export const metadataFilename = 'release-info.json';

/**
 * Writes package & release metadata to disk so that we can read it after changesets
 * have been consumed by `changeset version` in order to update dependent version ranges
 */
async function main() {
  const { root } = await getPackages(process.cwd());
  const releasePlan = await getReleasePlan(root.dir);

  await fsp.writeFile(
    path.resolve(process.cwd(), metadataFilename),
    JSON.stringify({
      releasePlan,
    }),
  );
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
