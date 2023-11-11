const fs = require('fs')
const path = require('path')
const should = require('should')
const sinon = require('sinon')
const request = require('request')
const stream = require('stream')
const imageHandler = require('./../../dadi/lib/handlers/image')
const factory = require('./../../dadi/lib/storage/factory')
const DiskStorage = require('./../../dadi/lib/storage/disk')
const HTTPStorage = require('./../../dadi/lib/storage/http')
const S3Storage = require('./../../dadi/lib/storage/s3')
const config = require('./../../config')

const configBackup = config.get()

describe('ImageHandler', function(done) {
  beforeEach(function(done) {
    done()
  })

  afterEach(function(done) {
    config.set(
      'caching.directory.enabled',
      configBackup.caching.directory.enabled
    )
    config.set('caching.redis.enabled', configBackup.caching.redis.enabled)

    config.set(
      'images.directory.enabled',
      configBackup.images.directory.enabled
    )
    config.set('images.s3.enabled', configBackup.images.s3.enabled)
    config.set('images.remote.enabled', configBackup.images.remote.enabled)
    config.set('images.directory.path', configBackup.images.directory.path)
    done()
  })

  it('should use Disk Storage adapter when nothing else is configured', function(done) {
    config.set('caching.directory.enabled', false)
    config.set('caching.redis.enabled', false)

    config.set('images.directory.enabled', false)
    config.set('images.s3.enabled', false)
    config.set('images.remote.enabled', false)
    config.set('images.directory.path', './test/images')

    const spy = sinon.spy(factory, 'create')

    const req = {
      url: '/test.jpg'
    }

    // set some expected values
    const expected = path.join(
      path.resolve(config.get('images.directory.path')),
      '/test.jpg'
    )

    // stub the get method so it doesn't do anything
    const get = sinon
      .stub(DiskStorage.DiskStorage.prototype, 'get')
      .callsFake(function() {
        return new Promise(function(resolve, reject) {
          const readable = new fs.createReadStream(expected)

          return resolve(readable)
        })
      })

    // this is the test
    const im = new imageHandler('jpg', req)

    im.get().then(function(stream) {
      factory.create.restore()
      DiskStorage.DiskStorage.prototype.get.restore()

      spy.called.should.eql(true)
      get.called.should.eql(true)

      const returnValue = spy.firstCall.returnValue

      returnValue.getFullUrl().should.eql(expected)

      done()
    })
  })

  it('should use Disk Storage adapter when configured', function(done) {
    config.set('caching.directory.enabled', false)
    config.set('caching.redis.enabled', false)

    config.set('images.directory.enabled', true)
    config.set('images.s3.enabled', false)
    config.set('images.remote.enabled', false)
    config.set('images.directory.path', './test/images')

    const spy = sinon.spy(factory, 'create')

    const req = {
      headers: {},
      url: '/test.jpg'
    }

    // set some expected values
    const expected = path.join(
      path.resolve(config.get('images.directory.path')),
      '/test.jpg'
    )

    // stub the get method so it doesn't do anything
    const get = sinon
      .stub(DiskStorage.DiskStorage.prototype, 'get')
      .callsFake(function() {
        return new Promise(function(resolve, reject) {
          const readable = new fs.createReadStream(expected)

          resolve(readable)
        })
      })

    // this is the test
    const im = new imageHandler('jpg', req)

    im.get().then(function(stream) {
      factory.create.restore()
      DiskStorage.DiskStorage.prototype.get.restore()

      spy.called.should.eql(true)
      get.called.should.eql(true)

      const returnValue = spy.firstCall.returnValue

      returnValue.getFullUrl().should.eql(expected)

      done()
    })
  })

  it('should use HTTP Storage adapter when configured', () => {
    this.timeout(5000)

    config.set('caching.directory.enabled', false)
    config.set('caching.redis.enabled', false)

    config.set('images.directory.enabled', false)
    config.set('images.s3.enabled', false)
    config.set('images.remote.enabled', true)
    config.set('images.remote.path', 'https://nodejs.org')

    const spy = sinon.spy(factory, 'create')

    const req = {
      headers: {},
      url: 'static/images/logos/nodejs-new-white-pantone.png'
    }

    // set some expected values
    const expected =
      'https://nodejs.org/static/images/logos/nodejs-new-white-pantone.png'

    // stub the get method so it doesn't do anything
    const get = sinon
      .stub(HTTPStorage.HTTPStorage.prototype, 'get')
      .callsFake(function() {
        return new Promise(function(resolve, reject) {
          const s = new stream.PassThrough()

          request
            .get(expected)
            .on('response', response => {})
            .on('error', err => {})
            .pipe(s)
          resolve(s)
        })
      })

    // this is the test
    const im = new imageHandler('jpg', req)

    return im.get().then(function(stream) {
      factory.create.restore()
      HTTPStorage.HTTPStorage.prototype.get.restore()

      spy.called.should.eql(true)
      get.called.should.eql(true)

      const returnValue = spy.firstCall.returnValue

      returnValue.getFullUrl().should.eql(expected)
    })
  })

  it('should use S3 Storage adapter when configured', function(done) {
    config.set('caching.directory.enabled', false)
    config.set('caching.redis.enabled', false)

    config.set('images.directory.enabled', false)
    config.set('images.s3.enabled', true)
    config.set('images.remote.enabled', false)

    const spy = sinon.spy(factory, 'create')

    const req = {
      url: '/test.jpg'
    }

    // set some expected values
    const expected = ['test.jpg']

    const testImage = path.join(
      path.resolve(config.get('images.directory.path')),
      '/test.jpg'
    )

    // stub the get method so it doesn't do anything
    const get = sinon
      .stub(S3Storage.S3Storage.prototype, 'get')
      .callsFake(function() {
        return new Promise(function(resolve, reject) {
          const readable = new fs.createReadStream(testImage)

          resolve(readable)
        })
      })

    // this is the test
    const im = new imageHandler('jpg', req)

    im.get().then(function(stream) {
      factory.create.restore()
      S3Storage.S3Storage.prototype.get.restore()

      spy.called.should.eql(true)
      get.called.should.eql(true)

      const returnValue = spy.firstCall.returnValue

      returnValue.urlParts.should.eql(expected)

      done()
    })
  })

  it('should return filename with jpg extension when a URL has no extension', function(done) {
    config.set('caching.directory.enabled', false)
    config.set('caching.redis.enabled', false)

    config.set('images.directory.enabled', false)
    config.set('images.s3.enabled', false)
    config.set('images.remote.enabled', true)

    const req = {
      headers: {},
      url: '/test'
    }

    // set some expected values
    const expected = 'test.jpg'

    const im = new imageHandler('jpg', req)

    im.getFilename().should.eql(expected)

    done()
  })
})
