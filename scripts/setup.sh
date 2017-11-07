#!/bin/bash

curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -

wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'

apt-get update
apt-get install -y git nodejs build-essential tcl google-chrome-stable supervisor

cd /home/ubuntu/
git clone https://github.com/Corei13/amazon-api-bot.git
cd amazon-api-bot
npm install

service supervisor stop

cat > /etc/supervisor/conf.d/amazon-api-bot.conf << EOL
[program:amazon-api-bot]
directory = /home/ubuntu/amazon-api-bot
command = npm run node src/cli
autorestart = true
stdout_logfile = /log/bot.log
stderr_logfile = /log/bot.err
environment = PORT=80, DAEMON=true, DEBUG=true, HEADLESS=true
EOL

mkdir /log
service supervisor start
