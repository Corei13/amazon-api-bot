// @flow

import ngrok from 'ngrok';
import twilio from 'twilio';
import express from 'express';
import bodyParser from 'body-parser';

import Logger from './logger';

const logger = new Logger('SERVER');

class CodeStore {
  get = () => new Promise(resolve => {
    if (this.code) {
      resolve(this.code);
      this.resolve = null;
    } else {
      this.resolve = resolve;
    }
  })
  set = code => {
    this.code = code;
    if (this.resolve) {
      this.resolve(code);
    }
  }
}

const server = () => {
  const app = express();

  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json({ limit: '200mb' }));

  app.use((req, res, next) => {
    req.requestTime = Date.now();
    next();
  });

  const codeStore = new CodeStore();

  app.post('/call', async (req, res, next) => {
    try {
      const twiml = new twilio.twiml.VoiceResponse();
      if (req.body.CallStatus === 'ringing') {
        const code = await codeStore.get();
        logger.info('verify with code:', code);

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

  app.use(({ requestTime, method, originalUrl }) => {
    const elapsed = (Date.now() - requestTime) / 1000;
    logger.info(method, originalUrl, logger.bold(elapsed.toFixed(2)));
  });

  const { PORT = 4000, TWILIO_SID, TWILIO_TOKEN, TWILIO_NUMBER } = process.env;
  const start = new Promise((resolve, reject) => {
    app.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}!`);

      ngrok.connect({ addr: PORT }, (err, url) => {
        if (err) {
          return reject(err);
        }
        logger.info('ngrok url:', url);

        let found = false;
        twilio(TWILIO_SID, TWILIO_TOKEN)
          .incomingPhoneNumbers
          .each({
            phoneNumber: TWILIO_NUMBER,
            limit: 1,
            callback: number => {
              found = true;
              number
                .update({ voiceUrl: `${url}/call` })
                .then(() => resolve(), reject);
            },
            done: () => found || reject(new Error(`Number not found: ${TWILIO_NUMBER}`))
          });
      });
    });
  });

  return {
    start: () => start,
    verify: code => codeStore.set(code),
    kill: () => server.close()
  };
};

export default server();
