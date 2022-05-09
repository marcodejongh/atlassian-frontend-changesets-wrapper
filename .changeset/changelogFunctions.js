const getLinkMD = (commit) => {
  return `[\`${commit}\`](https://bitbucket.org/atlassian/atlassian-frontend/commits/${commit})`;
};

const getReleaseLine = async (changeset) => {
  const indentedSummary = changeset.summary
    .split('\n')
    .map((l, i) => (i > 0 ? `  ${l}`.trimRight() : l))
    .join('\n');

  return `- ${getLinkMD(changeset.commit)} - ${indentedSummary}`;
};

const getDependencyReleaseLine = async (changesets, dependenciesUpdated) => {
  if (dependenciesUpdated.length === 0) return '';

  return '- Updated dependencies';
};

module.exports = {
  getReleaseLine,
  getDependencyReleaseLine,
};
