// Copyright (c) 2015 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

/* jshint maxparams:5 */
/*eslint max-params: [2, 5]*/

'use strict';

var path = require('path');
var TypedError = require('error/typed');
var thriftify = require('thriftify');

var allocCluster = require('./lib/alloc-cluster.js');
var TChannelAsThrift = require('../as/thrift.js');

var spec = thriftify.readSpecSync(
    path.join(__dirname, 'anechoic-chamber.thrift')
);

allocCluster.test('send and receiving an ok', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[1];

    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    tchannelAsThrift.send(client.request({
        serviceName: 'server'
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.equal(res.body, 10);
        assert.end();
    });
});

allocCluster.test('send and receive a not ok', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[1];

    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        notOkResponse: true
    });

    tchannelAsThrift.send(client.request({
        serviceName: 'server'
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(!res.ok);
        assert.equal(res.body.value, 10);
        assert.equal(res.body.message, 'No echo');
        assert.equal(res.body.nameAsThrift, 'noEcho');
        assert.equal(res.body.type, 'tchannel.hydrated-error.default-type');

        assert.end();
    });
});

allocCluster.test('send and receive a typed not ok', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[1];

    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        notOkTypedResponse: true
    });

    tchannelAsThrift.send(client.request({
        serviceName: 'server'
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(!res.ok);
        assert.equal(res.body.value, 10);
        assert.equal(res.body.message, 'No echo typed error');
        assert.equal(res.body.nameAsThrift, 'noEchoTyped');
        assert.equal(res.body.type, 'server.no-echo');

        assert.end();
    });
});

allocCluster.test('sending and receiving headers', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[1];

    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    tchannelAsThrift.send(client.request({
        serviceName: 'server'
    }), 'Chamber::echo', {
        headerA: 'headerA',
        headerB: 'headerB'
    }, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.deepEqual(res.head, {
            headerA: 'headerA',
            headerB: 'headerB'
        });
        assert.equal(res.body, 10);
        assert.end();
    });
});

allocCluster.test('getting an UnexpectedError frame', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[1];

    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        networkFailureResponse: true
    });

    var _error = client.logger.error;
    var messages = [];
    client.logger.error = function error(msg) {
        messages.push(msg);
        if (msg !== 'Got unexpected error in handler') {
            _error.apply(this, arguments);
        }
    };

    tchannelAsThrift.send(client.request({
        serviceName: 'server'
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, resp) {
        assert.ok(err);
        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'UnexpectedError');
        assert.equal(err.message, 'Unexpected Error');

        assert.equal(resp, undefined);
        assert.equal(messages.length, 1);

        assert.end();
    });
});

allocCluster.test('getting a BadRequest frame', {
    numPeers: 2
}, function t(cluster, assert) {
    makeTChannelThriftServer(cluster, {
        networkFailureResponse: true
    });
    var client = cluster.channels[1];

    client.request({
        serviceName: 'server',
        timeout: 1500,
        headers: {
            as: 'thrift'
        }
    }).send('Chamber::echo', 'junk header', null, onResponse);

    function onResponse(err, resp) {
        assert.ok(err);

        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'BadRequest');
        assert.equal(err.message,
            'tchannel-thrift-handler.parse-error.head-failed: Could not ' +
                'parse head (arg2) argument.\n' +
                'Expected Thrift encoded arg2 for endpoint Chamber::echo.\n' +
                'Got junk heade instead of Thrift.'
        );

        assert.equal(resp, null);

        assert.end();
    }
});

allocCluster.test('sending without as header', {
    numPeers: 2
}, function t(cluster, assert) {
    makeTChannelThriftServer(cluster, {
        networkFailureResponse: true
    });
    var client = cluster.channels[1];

    client.request({
        serviceName: 'server',
        timeout: 1500
    }).send('Chamber::echo', null, null, onResponse);

    function onResponse(err, resp) {
        assert.ok(err);

        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'BadRequest');
        assert.equal(err.message,
            'Expected call request as header to be thrift');

        assert.equal(resp, null);

        assert.end();
    }
});

function makeTChannelThriftServer(cluster, opts) {
    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'server'
    });
    var NoEchoTypedError = TypedError({
        type: 'server.no-echo',
        message: 'No echo typed error',
        nameAsThrift: 'noEchoTyped',
        value: null
    });

    cluster.channels[1].makeSubChannel({
        serviceName: 'server',
        peers: [
            cluster.channels[0].hostPort
        ]
    });

    var options = {
        isOptions: true
    };

    var fn = opts.okResponse ? okHandler :
        opts.notOkResponse ? notOkHandler :
        opts.notOkTypedResponse ? notOkTypedHandler :
        opts.networkFailureResponse ? networkFailureHandler :
            networkFailureHandler;

    var tchannelAsThrift = new TChannelAsThrift({
        spec: spec,
        logParseFailures: false
    });
    tchannelAsThrift.register(server, 'Chamber::echo', options, fn);

    return tchannelAsThrift;

    function okHandler(opts, req, head, body, cb) {
        return cb(null, {
            ok: true,
            head: head,
            body: body.value
        });
    }

    function notOkHandler(opts, req, head, body, cb) {
        return cb(null, {ok: false, body: NoEchoError(body.value)});
    }

    function notOkTypedHandler(opts, req, head, body, cb) {
        cb(null, {
            ok: false,
            body: NoEchoTypedError({
                value: body.value
            })
        });
    }

    function networkFailureHandler(opts, req, head, body, cb) {
        var networkError = new Error('network failure');

        cb(networkError);
    }

    function NoEchoError(value) {
        var err = new Error('No echo');
        err.nameAsThrift = 'noEcho';
        err.value = value;
        return err;
    }
}
