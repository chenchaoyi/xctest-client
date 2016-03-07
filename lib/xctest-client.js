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
const path = require('path');
const EventEmitter = require('events');
const childProcess = require('child_process');
const WebDriverAgent  = require('webdriveragent');

const _ = require('./helper');
const XCProxy = require('./proxy');
const logger = require('./logger');

const agentPath = WebDriverAgent.agentPath;
const AGENT_URL_REG = WebDriverAgent.AGENT_URL_REG;
const AGENT_LAUNCHED_REG = WebDriverAgent.AGENT_LAUNCHED_REG;

class XCTest extends EventEmitter {
  constructor(options) {
    super();
    this.proxy = null;
    this.capabilities = null;
    this.sessionId = null;
    this.sim = null;
    this.simLogProc = null;
    this.xcrunnerProc = null;
    Object.assign(this, {
      proxyHost: '127.0.0.1',
      proxyPort: 8100,
      urlBase: 'wd/hub'
    }, options || {});
    this.init();
  }

  init() {
    this.checkAgentPath();
    this.initPorxy();
  }

  checkAgentPath() {
    if (_.isExistedDir(agentPath)) {
      logger.info(`agent path: ${agentPath}`);
    } else {
      logger.error('agent path not found');
    }
  }

  initPorxy() {
    this.proxy = new XCProxy({
      proxyHost: this.proxyHost,
      proxyPort: this.proxyPort,
      urlBase: this.urlBase
    });
  }

  *startSimLog() {
    let logDir = path.resolve(this.sim.getLogDir(), 'system.log');
    let args =`-f -n 0 ${logDir}`.split(' ');
    var proc = childProcess.spawn('tail', args, {});
    this.simLogProc = proc;

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
            if (match[1].startsWith('http://')) {
              resolve();
            }
          }
        }
        //logger.debug(data);
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
    let args = `test -workspace ${agentPath} -scheme ${WebDriverAgent.schemeName} -destination id=${this.sim.deviceId}`.split(' ');

    var proc = childProcess.spawn('xcodebuild', args, {});
    this.xcrunnerProc = proc;
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
    let appDir = path.resolve(this.sim.getAppDir());
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
    yield [this.startSimLog(), this.startBootstrap()];
    return this.proxy.send('/session', 'POST', caps);
  }

  stop() {
    if (this.simLogProc) {
      this.simLogProc.kill();
    }
    if (this.xcrunnerProc) {
      this.xcrunnerProc.kill();
    }
  }

  sendCommand(url, method, body) {
    return this.proxy.send(url, method, body);
  }
}

module.exports = XCTest;
