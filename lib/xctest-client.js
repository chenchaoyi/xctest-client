/* ================================================================
 * xctest-client by xdf(xudafeng[at]126.com)
 *
 * first created at : Mon Feb 29 2016 23:02:22 GMT+0800 (CST)
 *
 * ================================================================
 * Copyright  xdf
 *
 * Licensed under the MIT License
 * You may not use this file except in compliance with the License.
 *
 * ================================================================ */

'use strict';

const fs = require('fs');
const url = require('url');
const path = require('path');
const iOSUtils= require('ios-utils');
const EventEmitter = require('events');
const childProcess = require('child_process');
const WebDriverAgent  = require('webdriveragent');

const _ = require('./helper');
const XCProxy = require('./proxy');
const logger = require('./logger');

const TEST_URL = 'http://bing.com';
const agentPath = WebDriverAgent.agentPath;
const AGENT_URL_REG = WebDriverAgent.AGENT_URL_REG;
const AGENT_LAUNCHED_REG = WebDriverAgent.AGENT_LAUNCHED_REG;

const isUIA = process.env.UIA && process.env.UIA === 'true';

class XCTest extends EventEmitter {
  constructor(options) {
    super();
    this.proxy = null;
    this.capabilities = null;
    this.sessionId = null;
    this.device = null;
    this.deviceLogProc = null;
    this.runnerProc = null;
    this.simWebDriverAgentPath = null;
    Object.assign(this, {
      proxyHost: '127.0.0.1',
      proxyPort: 8100,
      urlBase: 'wd/hub'
    }, options || {});
    this.init();
  }

  init() {
    this.checkAgentPath();
  }

  checkAgentPath() {
    if (_.isExistedDir(agentPath)) {
      logger.info(`agent path: ${agentPath}`);
    } else {
      logger.error('agent path not found');
    }
  }

  configUrl(str) {
    const urlObj = url.parse(str);
    this.proxyHost = urlObj.hostname;
    this.proxyPort = urlObj.port;
  }

  initProxy() {
    this.proxy = new XCProxy({
      proxyHost: this.proxyHost,
      proxyPort: this.proxyPort,
      urlBase: this.urlBase
    });
  }

  buildWebDriverAgent() {
    const cmd = `xcodebuild -workspace ${agentPath} -scheme WebDriverAgent -destination id=${this.device.deviceId} build`;

    return _.exec(cmd, {
      maxBuffer: 1024 * 10 * 512
    })
      .then((stdout) => {
        this.simWebDriverAgentPath = _.parseSimDir(stdout);
      });
  }

  launchWebDriverAgent() {
    const cmd = `${this.simWebDriverAgentPath}/WebDriverAgent.app/WebDriverAgent`;
    const proc = this.device.spawn(cmd);

    proc.stderr.setEncoding('utf8');
    proc.stdout.setEncoding('utf8');

    this.runnerProc = proc;
    return new Promise((resolve, reject) => {
      proc.stdout.on('data', data => {
        logger.debug(data);
      });

      proc.stderr.on('data', data => {
        logger.debug(data);
        if (AGENT_URL_REG.test(data)) {
          resolve();
        }
      });

      proc.stdout.on('error', (err) => {
        logger.warn(`launch WebDriverAgent error with ${err}`);
      });

      proc.on('exit', (code, signal) => {
        logger.warn(`WebDriverAgent exit with code: ${code}, signal: ${signal}`);
        reject();
      });

    });
  }

  *startSimLog() {
    let logDir = path.resolve(this.device.getLogDir(), 'system.log');
    let args =`-f -n 0 ${logDir}`.split(' ');
    var proc = childProcess.spawn('tail', args, {});
    this.deviceLogProc = proc;

    proc.stderr.setEncoding('utf8');
    proc.stdout.setEncoding('utf8');

    return new Promise((resolve, reject) => {
      proc.stdout.on('data', data => {
        if (AGENT_LAUNCHED_REG.test(data)) {
          // due to firewall
          //this.codesignApp();
        } else {
          let match = AGENT_URL_REG.exec(data);
          if (match) {
            const url = match[1];
            if (url.startsWith('http://')) {
              this.configUrl(url);
              resolve();
            }
          }
        }
        // logger.debug(data);
      });

      proc.stderr.on('data', data => {
        logger.debug(data);
      });

      proc.stdout.on('error', (err) => {
        logger.warn(`bootstrap error with ${err}`);
      });

      proc.on('exit', (code, signal) => {
        logger.warn(`bootstrap exit with code: ${code}, signal: ${signal}`);
        reject();
      });

    });
  }

  *startDeviceLog() {
    let args =['-u', this.device.deviceId];
    var proc = childProcess.spawn('idevicesyslog', args, {});
    this.deviceLogProc = proc;

    proc.stderr.setEncoding('utf8');
    proc.stdout.setEncoding('utf8');

    return new Promise((resolve, reject) => {
      proc.stdout.on('data', data => {
        if (AGENT_LAUNCHED_REG.test(data)) {
          // due to firewall
          //this.codesignApp();
        } else {
          let match = AGENT_URL_REG.exec(data);
          if (match) {
            const url = match[1];
            if (url.startsWith('http://')) {
              this.configUrl(url);
              resolve();
            }
          }
        }
        // logger.debug(data);
      });

      proc.stderr.on('data', data => {
        logger.debug(data);
      });

      proc.stdout.on('error', (err) => {
        logger.warn(`bootstrap error with ${err}`);
      });

      proc.on('exit', (code, signal) => {
        logger.warn(`bootstrap exit with code: ${code}, signal: ${signal}`);
        reject();
      });

    });
  }

  *startBootstrap() {
    let args = `test -workspace ${agentPath} -scheme ${WebDriverAgent.schemeName} -destination id=${this.device.deviceId}`.split(' ');

    var proc = childProcess.spawn('xcodebuild', args, {});
    this.runnerProc = proc;
    proc.stderr.setEncoding('utf8');
    proc.stdout.setEncoding('utf8');

    proc.stdout.on('data', () => {
    });

    proc.stderr.on('data', data => {
      logger.debug(data);
    });

    proc.stdout.on('error', (err) => {
      logger.warn(`xctest client error with ${err}`);
    });

    proc.on('exit', (code, signal) => {
      logger.warn(`xctest client exit with code: ${code}, signal: ${signal}`);
    });
  }

  codesignApp() {
    let appDir = path.resolve(this.device.getAppDir());
    let list = fs.readdirSync(appDir);
    list.forEach(item => {
      var appPath = path.join(appDir, item, WebDriverAgent.appName);
      if (_.isExistedDir(appPath)) {
        _.exec(`codesign --deep --strict --sign "xdf" ${appPath}`).then();
      }
    });
  }

  *start(caps) {
    this.capabilities = caps;
    const xcodeVersion = yield iOSUtils.getXcodeVersion();

    logger.debug(`xcode version: ${xcodeVersion}`);

    if (isUIA) {
      yield this.buildWebDriverAgent();
      yield [this.startSimLog(), this.launchWebDriverAgent()];
      yield this.device.launch(caps.desiredCapabilities.bundleId);
      yield _.sleep(3000);
    } else {
      if (this.isRealDevice(this.device.deviceId)) {
        yield [this.startDeviceLog(), this.startBootstrap()];
        yield _.sleep(3000);
      } else {
        yield [this.startSimLog(), this.startBootstrap()];
        yield _.sleep(3000);
      }
    }
    this.initProxy();

    if (caps.desiredCapabilities.browserName === 'Safari') {
      var promise = this.proxy.send('/session', 'POST', {'desiredCapabilities': {'bundleId': 'com.apple.mobilesafari'}});
      return Promise.all([this.device.openURL(TEST_URL), promise]);
    } else {
      return this.proxy.send('/session', 'POST', caps);
    }
  }

  isRealDevice(udid) {
    return !udid.includes('-');
  }

  stop() {
    if (this.deviceLogProc) {
      this.deviceLogProc.kill();
    }
    if (this.runnerProc) {
      this.runnerProc.kill();
    }
  }

  sendCommand(url, method, body) {
    return this.proxy.send(url, method, body);
  }
}

module.exports = XCTest;
