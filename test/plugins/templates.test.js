'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testtemplate = require('./data/template.json');
const testtemplates = require('./data/templates.json');
const testpipeline = require('./data/pipeline.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const decorateTemplateMock = (template) => {
    const mock = hoek.clone(template);

    mock.toJson = sinon.stub().returns(template);

    return mock;
};

const decoratePipelineMock = (template) => {
    const mock = hoek.clone(template);

    mock.toJson = sinon.stub().returns(template);

    return mock;
};

const getTemplateMocks = (templates) => {
    if (Array.isArray(templates)) {
        return templates.map(decorateTemplateMock);
    }

    return decorateTemplateMock(templates);
};

const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};

describe('template plugin test', () => {
    let templateFactoryMock;
    let pipelineFactoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        templateFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/templates');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            templateFactory: templateFactoryMock,
            pipelineFactory: pipelineFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        server.register([{
            register: plugin
        }], done);
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.templates);
    });

    describe('GET /templates', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/templates'
            };
        });

        it('returns 200 and all templates', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 500 when datastore fails', () => {
            templateFactoryMock.list.rejects(new Error('fittoburst'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /templates', () => {
        let options;
        let templateMock;
        let pipelineMock;
        const testId = 7969;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/templates/mytemplate/1.7',
                payload: {
                    name: 'mytemplate',
                    version: '1.7',
                    maintainer: 'foo@bar.com',
                    description: 'test template',
                    config: {
                        steps: [{
                            echo: 'echo hello'
                        }]
                    }
                },
                credentials: {
                    scope: ['build']
                }
            };

            templateMock = getTemplateMocks(testtemplate);
            templateFactoryMock.get.resolves(null);
            templateFactoryMock.create.resolves(templateMock);
            templateFactoryMock.list.resolves([templateMock]);

            pipelineMock = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 401 when scmUri does not match', () => {
            templateMock.scmUri = 'github.com:67890:branchName';
            templateFactoryMock.get.resolves(templateMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });

        it('creates template if template does not exist yet', () => {
            let expectedLocation;

            templateFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.deepEqual(reply.result, testtemplate);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(templateFactoryMock.create, {
                    name: 'mytemplate',
                    version: '1.7',
                    maintainer: 'foo@bar.com',
                    description: 'test template',
                    scmUri: 'github.com:12345:branchName',
                    labels: [],
                    config: { steps: [{ echo: 'echo hello' }] }
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('creates template if has good permission and it is a new version', () => {
            let expectedLocation;

            templateFactoryMock.list.resolves([templateMock]);
            templateFactoryMock.get.withArgs({
                name: 'mytemplate',
                version: '1.8'
            }).resolves(null);

            options.url = '/templates/mytemplate/1.8';
            options.payload.version = '1.8';

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.deepEqual(reply.result, testtemplate);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(templateFactoryMock.create, {
                    name: 'mytemplate',
                    version: '1.8',
                    maintainer: 'foo@bar.com',
                    description: 'test template',
                    scmUri: 'github.com:12345:branchName',
                    labels: [],
                    config: { steps: [{ echo: 'echo hello' }] }
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 409 it is an existing version', () => {
            templateFactoryMock.list.resolves([templateMock]);
            templateFactoryMock.get.resolves(templateMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            templateFactoryMock.list.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the template model fails to create', () => {
            const testError = new Error('templateModelCreateError');

            templateFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});