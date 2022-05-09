import { spawn } from 'child_process';

type Opts = {
  spawnOpts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  };
  timeout: number;
};

type ReturnVal = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

/** Either an input command string or a tuple of a string to wait for and the input command string */
export type Input = string | [string, string];

// https://www.tldp.org/LDP/abs/html/escapingsection.html
export const DOWN = '\x1B\x5B\x42';
export const UP = '\x1B\x5B\x41';
export const ENTER = '\x0D\n';
export const SPACE = '\x20';

export async function testCli(
  commandArgs: string[],
  inputs: Input[],
  userOpts: Partial<Opts> = {},
): Promise<ReturnVal> {
  const defaults = { spawnOpts: { cwd: process.cwd() }, timeout: 200 };
  const opts = {
    ...defaults,
    ...userOpts,
    spawnOpts: { ...defaults.spawnOpts, ...userOpts.spawnOpts },
  };

  return new Promise(async (resolve, reject) => {
    const proc = spawn(commandArgs[0], commandArgs.slice(1), opts.spawnOpts);
    let stdout = Buffer.from('');
    let stderr = Buffer.from('');
    let hasErrored = false;

    const id = setTimeout(() => {
      console.log('Test stuck...');
      console.log(stdout.toString());
    }, 20000);

    proc.stdout.on('data', data => {
      stdout = Buffer.concat([stdout, data]);
    });

    proc.stderr.on('data', data => {
      stderr = Buffer.concat([stderr, data]);
    });

    proc.on('exit', (code, signal) => {
      if (!hasErrored) {
        resolve({
          code,
          signal,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
        clearTimeout(id);
      } else {
        console.log('Received exit event after error');
      }
    });
    proc.on('error', err => {
      hasErrored = true;
      reject(err);
    });

    await inputs.reduce(
      (previousPromise: Promise<void> | null, input) =>
        new Promise(async resolve => {
          if (previousPromise) {
            await previousPromise;
          }

          function listenForOutput(data: Buffer) {
            const str = data.toString();
            if (str.includes(input[0])) {
              setTimeout(() => {
                proc.stdin.write(input[1]);
                resolve();
              }, 10);
              proc.stdout.off('data', listenForOutput);
            }
          }

          setTimeout(() => {
            if (typeof input === 'string') {
              proc.stdin.write(input);
              resolve();
            } else {
              if (stdout.toString().includes(input[0])) {
                proc.stdin.write(input[1]);
                resolve();
              } else {
                proc.stdout.on('data', listenForOutput);
              }
            }
          }, 10);
        }),
      null,
    );

    proc.stdin.end();
  });
}
