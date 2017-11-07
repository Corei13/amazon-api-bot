// @flow

import rp from 'request-promise';
import Chance from 'chance';

import Chrome from './chrome';
import Logger from './logger';

const logger = new Logger('MAIN');

export type Data = {
  name: string,
  email: string,
  password: string,
  address: {
    street: string,
    city: string,
    state: string,
    zip: number,
    phone: string
  },
  website: string,
  storeName: string,
  description: string
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const fake = (): Data => (
  chance => ({
    name: chance.name(),
    email: chance.email({ length: 10, domain: 'gmail.com' }),
    password: chance.string({ length: 10 }),
    address: {
      street: chance.address(),
      city: chance.city(),
      state: 'CA',
      zip: chance.integer({ min: 90001, max: 96162 }),
      phone: chance.phone({ formatted: false })
    },
    website: chance.domain(),
    storeName: chance.word(),
    description: chance.sentence()
  })
)(new Chance());

export const generate = async ({
  data, headless = false, phoneNo, visionApiKey, verifyPhone
}: {
  data: Data, headless?: boolean, phoneNo: string, visionApiKey: string,
  verifyPhone: (code: string) => void
}) => {
  const chrome = new Chrome({ headless });

  try {
    logger.info('Data:', JSON.stringify(data, null, 2));

    const pid = await chrome.start();
    logger.info('Chrome started with pid:', pid);

    // go to landing page
    await chrome.navigate({ url: 'https://affiliate-program.amazon.com/' });
    logger.debug('Navigated to:', 'https://affiliate-program.amazon.com/');
    await chrome.evaluateAsync(({ document }) => {
      const click = resolve => {
        const node = document.getElementById('a-autoid-0-announce');
        console.log('node:', node);
        if (node) {
          node.click();
          resolve();
        } else {
          setTimeout(() => click(resolve), 50);
        }
      };
      console.log('wtf!');
      return new Promise(resolve => click(resolve));
    });

    // sign up step 1
    await chrome.untilLoaded();
    logger.debug('Loaded sign in page');
    await chrome.evaluate(({ document }) => {
      document.getElementById('createAccountSubmit').click();
    }, { data });

    // sign up step 2
    await chrome.untilLoaded();
    logger.debug('Loaded sign up page');
    await chrome.evaluate(({ document }, { data }) => {
      document.getElementById('ap_customer_name').value = data.name;
      document.getElementById('ap_email').value = data.email;
      document.getElementById('ap_password').value = data.password;
      document.getElementById('ap_password_check').value = data.password;
      document.getElementById('continue').click();
    }, { data });

    // go to affiliate signup page
    await chrome.untilLoaded();
    await chrome.navigate({ url: 'https://affiliate-program.amazon.com/signup' });
    await chrome.evaluateAsync(async ({ document, window }, { data }) => {
      document.getElementById('ac-signup-ai-payee_name').value = data.name;
      document.getElementById('ac-signup-ai-payee_address_line_1').value = data.address.street;
      document.getElementById('ac-signup-ai-payee_city').value = data.address.city;
      document.getElementById('ac-signup-ai-payee_state').value = data.address.state;
      document.getElementById('ac-signup-ai-payee_zipcode').value = data.address.zip;
      document.getElementById('ac-signup-ai-payee_phone_number').value = data.address.phone;
      document.getElementById('ac-wizard-signup-next-btn-announce').click();

      const waitElemToExist = (attr, value) => new Promise(resolve => {
        const observer = new window.MutationObserver(mutations =>
          mutations.forEach(({ addedNodes }) => {
            if (addedNodes) {
              addedNodes.forEach(node => {
                console.log(attr, value, node);
                if (node.getAttribute && node.getAttribute(attr) === value) {
                  console.log('Found:', node);
                  observer.disconnect();
                  resolve(node);
                }
              });
            }
          })
        );

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: false
        });
      });

      await waitElemToExist('class', 'ac-card');

      document.getElementById('ac-site-list-add-text-website').value = data.website;
      document.getElementById('ac-signup-sl-ws-add-btn-announce').click();
      document.getElementById('ac-signup-sl-next-btn').click();
      document.getElementById('ac-site-list-compliance-no').children[0].children[0].click();
      document.getElementById('ac-signup-sl-confirm-btn-announce').click();

      await waitElemToExist('id', 'ac-signup-sp-form');

      document.getElementById('ac-signup-sp-store_name').value = data.storeName;
      document.getElementById('ac-signup-sp-description').value = data.description;

      // TODO: make the following customizable
      document.getElementById('ac-signup-sp-topic').value = 'Books';
      document.getElementById('ac-signup-sp-segment').value = 'Search';
      document.getElementById('ac-signup-sp-monetize_channel').value = 'ECommerce';
      document.getElementById('ac-signup-sp-link_building_method').value = 'TextEditor';
      document.getElementById('ac-signup-sp-unique_visitors').value = 'LessThan500';
      document.getElementById('ac-signup-sp-expectation').value = 'Content';
      document.getElementById('ac-signup-sp-discovery_method').value = 'WordOfMouth';
      document.getElementById('ac-signup-sp-product_category_Books').click();
      document.getElementById('ac-signup-sp-promo_channel_PaidSearch').click();
    }, { data });

    const solveCaptcha = async (attempt = 0) => {
      if (attempt === 5) {
        throw new Error('Too many attempts!');
      }

      const imageUri = await chrome.evaluate(({ document }) => {
        return document.getElementById('ac-signup-sp-captcha').children[0].src;
      });

      const { body: { responses: [{ fullTextAnnotation: { text: captcha } }] } } = await rp({
        uri: `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
        json: true,
        resolveWithFullResponse: true,
        method: 'POST',
        body: {
          requests: [{
            image: { source: { imageUri } },
            features: [ { type: 'TEXT_DETECTION' } ]
          }]
        }
      });

      // sign up step 2
      logger.info('Entering captcha', captcha);
      const phoneCode = await chrome.evaluateAsync(async ({ document, window }, { captcha, phoneNo }) => {
        document.getElementById('ac-signup-sp-captcha_response').value = captcha.replace(/\s/g, '').toLowerCase();
        document.getElementById('ac-wizard-signup-next-btn-announce').click();
        const waitElemToExist = condition => new Promise((resolve, reject) => {
          const observer = new window.MutationObserver(mutations => {
            mutations.forEach(mutation => console.log('Mutation:', mutation));
            mutations.forEach(({ addedNodes, target, attributeName }) => {
              if (addedNodes) {
                addedNodes.forEach(node => {
                  console.log(condition.toString(), node);
                  if (condition(node)) {
                    console.log('Node:', node);
                    observer.disconnect();
                    resolve(node);
                  }
                });
              }
              if (target.nodeName === 'IMG' && attributeName === 'src') {
                observer.disconnect();
                setTimeout(reject, 1000);
              }
            });
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: false
          });
        });

        try {
          await waitElemToExist(node => node.id === 'ac-signup-iv-pin-form');
        } catch (error) {
          return null;
        }
        document.getElementById('ac-signup-iv-payee_phone_number').value = phoneNo;
        document.getElementById('ac-signup-iv-call_btn-announce').click();
        const { textContent: phoneCode } = await waitElemToExist(
          node => node.parentElement
            && node.parentElement.parentElement
            && node.parentElement.parentElement.id === 'ac-signup-iv-pin'
        );

        return phoneCode;
      }, { captcha, phoneNo });

      logger.warn('Attempt:', attempt, 'Code:', phoneCode);
      return phoneCode || await delay(1000).then(() => solveCaptcha(attempt + 1));
    };

    const phoneCode = await solveCaptcha();
    verifyPhone(phoneCode);

    const tag = await chrome.evaluateAsync(async ({ document, window }) => {
      const waitElemToExist = condition => new Promise(resolve => {
        const observer = new window.MutationObserver(mutations =>
          mutations.forEach(({ addedNodes }) => {
            if (addedNodes) {
              addedNodes.forEach(node => {
                console.log(condition.toString(), node);
                if (condition(node)) {
                  console.log('Found:', node);
                  observer.disconnect();
                  resolve(node);
                }
              });
            }
          })
        );

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: false
        });
      });

      await waitElemToExist(node => node.textContent.includes('Congratulations'));
      document.getElementById('ac-signup-iv-op_agreement_code').click();
      document.getElementById('ac-wizard-signup-next-btn-announce').click();

      await waitElemToExist(node => node.querySelector && node.querySelector('#ac-signup-pa-payment-later-btn'));
      const tag = document.querySelector('.ac-card .msg').textContent;
      document.getElementById('ac-signup-pa-payment-later-btn').click();
      return tag;
    });

    logger.info('Got associate tag:', tag.match(/[^\s]+-20/)[0]);

    await chrome.navigate({ url: 'https://affiliate-program.amazon.com/gp/flex/advertising/api/sign-in.html' });

    const { awsId, awsSecret } = await chrome.evaluateAsync(async ({ document, window }) => {
      document.getElementById('ac-paapi-action-create-account-button').click();

      const waitElemToExist = condition => new Promise(resolve => {
        const observer = new window.MutationObserver(mutations =>
          mutations.forEach(({ addedNodes }) => {
            if (addedNodes) {
              addedNodes.forEach(node => {
                console.log(condition.toString(), node);
                if (condition(node)) {
                  console.log('Found:', node);
                  observer.disconnect();
                  resolve(node);
                }
              });
            }
          })
        );

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: false
        });
      });

      await waitElemToExist(node => node.getAttribute && node.getAttribute('class') === 'ac-paapi-create-credentials');

      return {
        awsId: document.getElementById('ac-paapi-access-key').value,
        awsSecret: document.getElementById('ac-paapi-secret-key').value
      };
    });

    logger.success(logger.bold(`{
      awsId: '${awsId}',
      awsSecret: '${awsSecret}',
      assocId: '${tag.match(/[^\s]+-20/)[0]}'
    }`));

    await chrome.kill();

    return {
      assocId: tag.match(/[^\s]+-20/)[0],
      awsId,
      awsSecret
    };
  } catch (err) {
    logger.error(err);
    await chrome.kill();
    throw err;
  }
};
