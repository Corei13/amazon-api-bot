# amazon-api-bot
Automagically generate amazon product advertising api credentials!

# Installation
```
npm install -g amazon-api-bot
```

# Getting Started
Before using amazon-api-bot, you'll need
- [API Key](https://support.google.com/cloud/answer/6158862?hl=en
) for [Google Vision API](https://cloud.google.com/vision/) - to solve captchas
- A [Twilio](https://www.twilio.com/) account with [api credentials](https://www.twilio.com/docs/api/rest/request
) (SID and token) and a [Twilio phone number](https://www.twilio.com/phone-numbers) - to pass phone verification


Then set these environment variables,
```bash
export VISION_API_KEY=your_vision_api_key
export TWILIO_SID=your_twilio_sid
export TWILIO_TOKEN=your_twilio_token
export TWILIO_NUMBER=your_twilio_number
```

Now run
```
DEBUG=true amazon-api-bot
```
