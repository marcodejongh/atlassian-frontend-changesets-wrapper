# Changesets

Changesets related utils & scripts.

This is what we use in atlassian-frontend, we interact with it in the following ways:

Changeset command for adding a changeset:
```
"changeset": "cd build/dev/changesets && yarn execute",
```

Command for looping to raw changeset command:
```
    "changeset:raw": "changeset",
```

Wrapper command for empty changeset
```
"changeset:empty": "yarn changeset --empty",
```
Empty is the old way of marking a changeset as non-releasable, it should be deprecated so it should *not* be moved into our changesets for. I've only listed it for posterity.


Command for adding a none releasable changeset:
```
"changeset:none": "yarn changeset --none",
```


Command on CI for checking everything has a changeset:
```
"check-changesets": "cd build/legacy/ci-scripts && yarn check-changesets",
```
I've moved those files into legacy-ci-scripts