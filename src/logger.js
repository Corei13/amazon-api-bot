/* @flow */

import moment from 'moment';
import { bold, cyan, yellow, red, green } from 'chalk';

export type logFn = (...args: Array<any>) => void;

const now = (): string => moment.utc().add(6, 'hours').format('YYYY/MM/DD HH:mm:ss');

const log = (
  args: Array<any>, fn: (_: mixed) => string = (arg: any): any => arg
): void => process.env.DEBUG
  ? console.log(fn(bold(`[${now()}]`)), ...args.map(fn))
  : undefined;


const debug: logFn = (...args) => log(args);
const info: logFn  = (...args) => log(args, arg => cyan(arg));
const warn: logFn  = (...args) => log(args, arg => yellow(arg));
const error: logFn = (...args) => log(args, arg => red(arg));
const success: logFn = (...args) => log(args, arg => green(arg));

export default class Logger {
  name: string;
  bold: (_: any) => string = bold;
  debug: logFn = debug;
  info: logFn = info;
  warn: logFn = warn;
  error: logFn = error;
  success: logFn = success;

  constructor(name?: string) {
    if (name) {
      this.name = name;
      const wrap = fn => (...args) => fn(`(${this.name})`, ...args);
      this.debug = wrap(this.debug);
      this.info = wrap(this.info);
      this.warn = wrap(this.warn);
      this.error = wrap(this.error);
      this.success = wrap(this.success);
    }
  }
};
