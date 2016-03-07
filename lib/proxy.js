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

const request = require('request');

const _ = require('./helper');
const logger = require('./logger');

class XCProxy {
  constructor(options) {
    Object.assign(this, {
      scheme: 'http',
      proxyHost: '127.0.0.1',
      proxyPort: 8100,
      urlBase: 'wd/hub',
      sessionId: null,
      originSessionId: null
    }, options);
  }


  handleNewUrl(url) {
    const sessionReg = /\/session\/([^\/]+)/;
    const wdSessionReg = new RegExp(`${this.urlBase}\/session\/([^\/]+)`);
    url = `${this.scheme}://${this.proxyHost}:${this.proxyPort}${url}`;

    if (sessionReg.test(url) && this.sessionId) {
      this.originSessionId = url.match(sessionReg)[1];
      url = url.replace(wdSessionReg, `session/${this.sessionId}`);
    }
    return url;
  }

  send(url, method, body) {
    return new Promise((resolve, reject) => {
      method = method.toUpperCase();
      const newUrl = this.handleNewUrl(url);

      const reqOpts = {
        url: newUrl,
        method: method,
        headers: {
          'Content-type': 'application/json;charset=UTF=8'
        },
        resolveWithFullResponse: true
      };

      if (body) {
        if (typeof body !== 'object') {
          body = JSON.parse(body);
        }
        reqOpts.json = body;
      }

      logger.info(`Proxy: ${url}:${method} to ${newUrl}:${method} with body: ${_.trunc(JSON.stringify(body), 200)}`);

      request(reqOpts, (error, res, body) => {
        if (error) {
          logger.error(`xctest client proxy error with: ${error}`);
          return reject(error);
        }

        if (body && body.sessionId) {
          this.sessionId = body.sessionId;
          body.sessionId = this.originSessionId;
        }

        logger.info(`Got response with status ${res.statusCode}: ${_.trunc(JSON.stringify(body), 200)}`);

        resolve(body);
      });
    });
  }
}

module.exports = XCProxy;
