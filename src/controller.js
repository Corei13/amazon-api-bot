// @flow

import type { Data } from './';

import ngrok from 'ngrok';
import twilio from 'twilio';
import express from 'express';
import bodyParser from 'body-parser';

import { generate, fake } from './';
import Logger from './logger';

const logger = new Logger('SERVER');

class CodeStore {
  codes: { [_: string]: string } = {};
  resolve: { [_: string]: ?Function } = {};

  get = (number: string) => new Promise(resolve => {
    if (this.codes[number]) {
      resolve(this.codes[number]);
      this.resolve[number] = null;
    } else {
      this.resolve[number] = resolve;
    }
  })
  set = (number: string, code: string) => {
    this.codes[number] = code;
    if (this.resolve[number]) {
      this.resolve[number](code);
    }
  }
}

export default class Controller {
  port: number;
  twilio: { numbers: Array<string>, sid?: string, token?: string };
  visionApiKey: ?string;
  codeStore: CodeStore = new CodeStore();
  server: Object;
  ngrokUrl: string;

  constructor({ port = 4000, twilio, visionApiKey }: { port?: number, twilio?: { sid?: string, token?: string }, visionApiKey?: string } = {}) {
    this.port = port;
    this.twilio = { ...twilio, numbers: [] };
    this.visionApiKey = visionApiKey;
  }

  getRandomNumber() {
    if (this.twilio.numbers.length === 0) {
      throw new Error('No twilio phone number is available.');
    };
    return this.twilio.numbers[Math.floor(Math.random() * this.twilio.numbers.length)];
  }

  getVisionApiKey() {
    if (!this.visionApiKey) {
      throw new Error('Vision API key is not available.');
    }
    return this.visionApiKey;
  }

  setVisionApiKey(visionApiKey: string) {
    this.visionApiKey = visionApiKey;
  }

  setTwilioSid(sid: string) {
    this.twilio.sid = sid;
  }

  setTwilioToken(token: string) {
    this.twilio.token = token;
  }

  start() {
    const app = express();

    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json({ limit: '200mb' }));

    app.use((req, res, next) => {
      req.requestTime = Date.now();
      next();
    });

    app.get('/secrets', (req, res, next) => {
      res.status(200).send({
        twilio: this.twilio,
        visionApiKey: this.visionApiKey
      });
      next();
    });

    app.delete('/secrets/number/:number', (req, res, next) => {
      this.twilio.numbers = this.twilio.numbers.filter(number => number !== req.params.number);
      res.status(200).send({
        twilio: this.twilio,
        visionApiKey: this.visionApiKey
      });
      next();
    });

    app.post('/secrets', async (req, res, next) => {
      try {
        const { body: { twilio: { sid, token, numbers } = {}, visionApiKey } } = req;

        sid && this.setTwilioSid(sid);
        token && this.setTwilioToken(token);
        if (Array.isArray(numbers)) {
          const toAdd = numbers.filter(number => !this.twilio.numbers.includes(number));
          toAdd.length > 0 && await this.addTwilioNumbers(toAdd);
        }
        visionApiKey && this.setVisionApiKey(visionApiKey);
        res.status(200).send({
          twilio: this.twilio,
          visionApiKey: this.visionApiKey
        });
        next();
      } catch (err) {
        next(err);
      }
    });

    app.get('/generate', (req, res, next) =>
      this.generate()
        .then(result => {
          res.status(200).send({ result });
          next();
        })
        .catch(err => next(err))
    );

    app.post('/generate', (req, res, next) =>
      this.generate(req.body)
        .then(result => {
          res.status(200).send(result);
          next();
        })
        .catch(err => next(err))
    );

    app.post('/call/:number', async (req, res, next) => {
      try {
        const twiml = new twilio.twiml.VoiceResponse();
        if (req.body.CallStatus === 'ringing') {
          const code = await this.codeStore.get(req.params.number);
          logger.info('Verify with code:', code);

          twiml.say('', { voice: 'alice' });
          twiml.pause({ length: 2 });
          twiml.play({ digits: code });
          twiml.record();
        }

        res.type('text/xml');
        res.send(twiml.toString());
        next();
      } catch (err) {
        next(err);
      }
    });

    app.use((err, req, res, next) => {
      res.status(500).send({ error: err.message });
      logger.error(req.originalUrl, err.stack);
      next();
    });

    return new Promise((resolve, reject) => {
      ngrok.connect({ addr: this.port }, (err, url) => {
        if (err) {
          return reject(err);
        }
        logger.info('ngrok url:', url);
        this.ngrokUrl = url;
        this.server = app.listen(this.port, () => {
          logger.info(`Listening on port ${this.port}!`);
          this.server.setTimeout(300000, resolve);
        });
      });
    });
  }

  addTwilioNumbers(numbers: Array<string>) {
    return new Promise(resolve => {
      const promises = [];

      if (!this.twilio.sid) {
        throw new Error('Twilio SID is not available.');
      }

      if (!this.twilio.token) {
        throw new Error('Twilio token is not available.');
      }

      twilio(this.twilio.sid, this.twilio.token)
        .incomingPhoneNumbers
        .each({
          callback: t => {
            const number = numbers.find(number => t.phoneNumber.includes(number));
            if (number) {
              logger.info(`Found ${number} as ${t.phoneNumber}`);
              promises.push(
                t.update({ voiceUrl: `${this.ngrokUrl}/call/${number}` })
                .then(() => this.twilio.numbers.push(number))
              );
            }
          },
          done: () => Promise.all(promises).then(resolve)
        });
    });
  }

  generate(data?: Data) {
    const phoneNo = this.getRandomNumber();
    return generate({
      data: data || fake(),
      headless: !!process.env.HEADLESS,
      phoneNo,
      visionApiKey: this.getVisionApiKey(),
      verifyPhone: code => this.verify(phoneNo, code)
    });
  }

  verify(number: string, code: string) {
    return this.codeStore.set(number, code);
  }

  kill() {
    return Promise.all([ ngrok.kill(), this.server && this.server.close() ]);
  }
};
