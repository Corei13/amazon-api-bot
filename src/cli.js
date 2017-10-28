#!/usr/bin/env node

// @flow
import Controller from './controller';

if (process.env.DAEMON) {
  const controller = new Controller();
  controller.start();
} else {
  const { TWILIO_SID, TWILIO_TOKEN, TWILIO_NUMBERS, VISION_API_KEY } = process.env;

  if (!TWILIO_SID) {
    throw new Error('TWILIO_SID is required');
  }
  if (!TWILIO_TOKEN) {
    throw new Error('TWILIO_TOKEN is required');
  }
  if (!TWILIO_NUMBERS) {
    throw new Error('TWILIO_NUMBERS is required');
  }
  if (!VISION_API_KEY) {
    throw new Error('VISION_API_KEY is required');
  }

  const controller = new Controller({
    twilio: {
      sid: TWILIO_SID,
      token: TWILIO_TOKEN
    },
    visionApiKey: VISION_API_KEY
  });

  controller.start()
    .then(() => controller.addTwilioNumbers(TWILIO_NUMBERS.split(',').map(n => n.trim())))
    .then(() => controller.generate())
    .then(({ assocId, awsId, awsSecret }) => {
      console.log('Associate Tag:', assocId);
      console.log('Access Key:', awsId);
      console.log('Secret Key:', awsSecret);
    }, console.error)
    .then(() => controller.kill());
}
