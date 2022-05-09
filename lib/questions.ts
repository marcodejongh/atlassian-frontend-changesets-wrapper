import { prompt } from 'enquirer';
import termSize from 'term-size';
import chalk from 'chalk';
import { Package } from '@manypkg/get-packages';

type ConfirmResponse = Record<string, string>;
type AutocompleteResponse = Record<string, string[]>;

let id = 0;
function getId() {
  return id++;
}

async function askConfirm(message: string, initial = false) {
  const name = `confirm-${getId()}`;
  const response = await prompt<ConfirmResponse>([
    {
      message,
      name,
      type: 'confirm',
      initial,
    },
  ]);

  return response[name];
}

async function askChoices(
  message: string,
  choices: Array<any>,
  format?: (x?: string | string[]) => string | undefined,
  result?: (x: string[]) => string[],
) {
  const name = `checkbox-${getId()}`;
  const response = await prompt<AutocompleteResponse>({
    type: 'autocomplete',
    name,
    message,
    multiple: true,
    choices,
    format,
    result,
    limit: Math.max(termSize().rows - 5, 10),
  });

  return response[name];
}

export async function askQuestions() {
  const isUx = await askConfirm(
    'Is this a UX change? (http://go.atlassian.com/af-ccm)',
  );

  if (isUx) {
    console.log(
      `\n${chalk.redBright(
        'NOTE:',
      )} As this is a UX change, please ensure you clearly explain ${chalk.bold(
        'how',
      )} and ${chalk.bold(
        'where',
      )} the UI/UX has changed to help products to evaluate change level\n`,
    );
  }

  return { isUx };
}

export async function createNonePackagesQuestion(
  changedPackages: Array<string>,
  allPackages: Array<Package>,
) {
  const unchangedPackagesNames = allPackages
    .map(({ packageJson }) => packageJson.name)
    .filter(name => !changedPackages.includes(name));

  const allChoices = [
    {
      name: 'changed packages',
      choices: [...changedPackages],
    },
    {
      name: 'unchanged packages',
      choices: unchangedPackagesNames,
    },
  ].filter(({ choices }) => choices.length !== 0);

  const filterCategories = (selected: string[]) =>
    selected.filter(
      x => x !== 'changed packages' && x !== 'unchanged packages',
    );

  return () =>
    askChoices(
      'Which packages would you like to include?',
      allChoices,
      selected =>
        Array.isArray(selected)
          ? filterCategories(selected)
              .map(x => chalk.cyan(x))
              .join(', ')
          : selected,
      selected => filterCategories(selected),
    );
}
