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

const TEST_URL = 'http://macacajs.github.io/macaca/';
const projectPath = WebDriverAgent.projectPath;
const AGENT_URL_REG = WebDriverAgent.AGENT_URL_REG;

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
    this.checkProjectPath();
  }

  checkProjectPath() {
    if (_.isExistedDir(projectPath)) {
      logger.info(`project path: ${projectPath}`);
    } else {
      logger.error('project path not found');
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

  *startSimLog() {
    let logDir = path.resolve(this.device.getLogDir(), 'system.log');
    let args =`-f -n 0 ${logDir}`.split(' ');
    var proc = childProcess.spawn('tail', args, {});
    this.deviceLogProc = proc;

    proc.stderr.setEncoding('utf8');
    proc.stdout.setEncoding('utf8');

    return new Promise((resolve, reject) => {
      proc.stdout.on('data', data => {
        let match = AGENT_URL_REG.exec(data);
        if (match) {
          const url = match[1];
          if (url.startsWith('http://')) {
            this.configUrl(url);
            resolve();
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
      this.startBootstrap();
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
        let match = AGENT_URL_REG.exec(data);
        if (match) {
          const url = match[1];
          if (url.startsWith('http://')) {
            this.configUrl(url);
            resolve();
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
      this.startBootstrap();
    });
  }

  startBootstrap() {
    let args = `test -project ${WebDriverAgent.projectPath} -scheme ${WebDriverAgent.schemeName} -destination id=${this.device.deviceId}`.split(' ');

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

    if (this.isRealDevice(this.device.deviceId)) {
      yield this.startDeviceLog();
    } else {
      yield this.startSimLog();
    }
    this.initProxy();

    if (caps.desiredCapabilities.browserName === 'Safari') {
      var promise = this.proxy.send('/session', 'POST', {
        desiredCapabilities: {
          bundleId: 'com.apple.mobilesafari'
        }
      });
      return Promise.all([this.device.openURL(TEST_URL), promise]);
    } else {
      yield _.sleep(10000);
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
