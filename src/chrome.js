// @flow

import EventEmitter from 'events';
import { launch } from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import { randomUserAgent } from './user-agents';

import Logger from './logger';

const logger = new Logger('CHROME');

export default class Chrome {
  runs: number = 0;
  protocol: { Page: Object, Runtime: Object };
  listener: EventEmitter = new EventEmitter();
  flags: Array<string> = [];
  kill: Function = () => { throw Error('Not implemented'); };

  constructor({
    headless = false,
    height = 900, width = 1440,
    // proxy
  }: {
    headless?: boolean,
    height?: number, width?: number,
    // proxy?: string
  } = {}) {
    this.flags = [
      headless ? '--headless' : '',
      // proxy ? `--proxy-server="${proxy}"` : '',
      // proxy ? '--host-resolver-rules="MAP * 0.0.0.0 , EXCLUDE 127.0.0.1"' : '', // FIXME
      `--user-agent="${randomUserAgent()}"`,
      `--window-size=${height},${width}`,
      '--disable-gpu',
      '--enable-logging',
      '--log-level=0',
      '--v=99',
	    // '--single-process', // fixme
	    '--no-sandbox'
    ];
  }

  async launch() {
    return new Promise((resolve, reject) =>
      launch({
        chromeFlags: this.flags
      }).then(resolve, reject)
    );
  }

  async start() {
    const chrome = await this.launch();
    this.kill = () => chrome.kill();

    const tabs = await CDP.List({ port: chrome.port });
    // console.log(tabs.find(t => t.type === 'page'));
    this.protocol = await new Promise((resolve, reject) =>
      CDP({ port: chrome.port, target: tabs.find(t => t.type === 'page') }, protocol => resolve(protocol))
        .on('error', err => reject(Error('Cannot connect to Chrome:' + err)))
    );

    const { Page, Runtime } = this.protocol;
    await Promise.all([Page.enable(), Runtime.enable()]);

    Page.loadEventFired((...args) => {
      this.listener.emit('pageLoaded', ...args);
    });

    return chrome.pid;
  }

  untilLoaded() {
    return new Promise(resolve => {
      const listener = () => {
        this.listener.removeListener('pageLoaded', listener);
        resolve();
      };
      this.listener.on('pageLoaded', listener);
    });
  }

  async navigate({ url }: { url: string }) {
    await this.protocol.Page.navigate({ url });
    const connectedAt = Date.now();
    await this.untilLoaded();
    const loadedAt = Date.now();
    this.runs += 1;

    return { connectedAt, loadedAt };
  }

  async evaluate(fn: Function, context: Object = {}, evaluateArgs: Object = {}) {
    const { Runtime } = this.protocol;
    const expression = `(${fn.toString()})({ document, window }, ${JSON.stringify(context)})`;
    const result = await Runtime.evaluate({ expression, returnByValue: true, ...evaluateArgs });
    logger.info('Expression:');
    logger.debug(expression);
    logger.info('Result:');
    logger.debug(result);
    return result.result.value;
  }

  evaluateAsync(fn: Function, context: Object = {}) {
    return this.evaluate(fn, context, { awaitPromise: true });
  }
}
