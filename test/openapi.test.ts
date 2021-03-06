import mm from 'egg-mock';
import * as assert from 'assert';

describe('openapi', () => {
  let app: any;
  before(() => {
    app = mm.app({
      baseDir: 'example',
      plugin: 'controller',
    } as any);
    return app.ready();
  });

  after(() => app.close());

  afterEach(mm.restore);

  it('normal', () => {
    assert.deepEqual(
      require('./fixtures/example/run/openapi_3.json'),
      require('./fixtures/openapi/example.json'),
    );
  });
});
