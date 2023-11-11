const Cache = require('./../cache')
const compressor = require('node-minify')
const config = require('./../../../config')
const fs = require('fs')
const help = require('./../help')
const mkdirp = require('mkdirp')
const path = require('path')
const StorageFactory = require('./../storage/factory')
const url = require('url')

/**
 * Creates a new CSSHandler instance.
 *
 * @param {String} format The extension of the file being handled
 * @param {Object} req    The request instance
 */
const CSSHandler = function(format, req, {options = {}} = {}) {
  this.options = options
  this.url = url.parse(req.url, true)

  this.isExternalUrl =
    this.url.pathname.indexOf('http://') > 0 ||
    this.url.pathname.indexOf('https://') > 0

  this.isCompressed = Boolean(
    this.options.compress || this.url.query.compress === '1'
  )

  this.cache = Cache()
  this.cacheKey = [
    req.__domain,
    this.url.href,
    JSON.stringify({
      compress: this.isCompressed
    })
  ]

  this.req = req

  this.storageFactory = Object.create(StorageFactory)
  this.storageHandler = null
}

/**
 * Retrieves a file for a given URL path.
 *
 * @return {Promise} A stream with the file
 */
CSSHandler.prototype.get = function() {
  return this.cache
    .getStream(this.cacheKey, {
      ttl: config.get('caching.ttl', this.req.__domain)
    })
    .then(stream => {
      if (stream) {
        this.isCached = true

        return stream
      }

      this.storageHandler = this.storageFactory.create(
        'asset',
        this.url.pathname.slice(1),
        {domain: this.req.__domain}
      )

      // Aborting the request if full remote URL is required and not enabled.
      if (
        this.isExternalUrl &&
        (!config.get('assets.remote.enabled', this.req.__domain) ||
          !config.get('assets.remote.allowFullURL', this.req.__domain))
      ) {
        const err = {
          statusCode: 403,
          message:
            'Loading assets from a full remote URL is not supported by this instance of DADI CDN'
        }

        return Promise.reject(err)
      }

      return this.storageHandler
        .get()
        .then(stream => {
          return this.transform(stream)
        })
        .then(stream => {
          return this.cache.cacheFile(stream, this.cacheKey, {
            ttl: config.get('caching.ttl', this.req.__domain)
          })
        })
    })
    .then(stream => {
      return help.streamToBuffer(stream)
    })
}

/**
 * Returns the content type for the files handled.
 *
 * @return {String} The content type
 */
CSSHandler.prototype.getContentType = function() {
  return 'text/css'
}

/**
 * Returns the filename for the given request.
 *
 * @return {String} The filename
 */
CSSHandler.prototype.getFilename = function() {
  return this.url.pathname.split('/').slice(-1)[0]
}

/**
 * Returns the last modified date for the asset.
 *
 * @return {Number} The last modified timestamp
 */
CSSHandler.prototype.getLastModified = function() {
  if (!this.storageHandler || !this.storageHandler.getLastModified) return null

  return this.storageHandler.getLastModified()
}

/**
 * Sets the base URL (excluding any recipe or route nodes)
 */
CSSHandler.prototype.setBaseUrl = function(baseUrl) {
  this.url = url.parse(baseUrl, true)
}

/**
 * Transforms the code from the stream provided
 *
 * @param  {Stream} stream The input stream
 * @return {Promise<Stream>}
 */
CSSHandler.prototype.transform = function(stream) {
  const tmpDir = path.resolve('./tmp')

  if (!this.isCompressed) return Promise.resolve(stream)

  return new Promise((resolve, reject) => {
    mkdirp(tmpDir, err => {
      if (err) return reject(err)

      const fileName = path.basename(this.url.pathname)
      const fileIn = path.join(tmpDir, fileName)
      const fileOut = path.join(
        tmpDir,
        path.basename(fileName, '.css') + '.min.css'
      )

      stream.pipe(fs.createWriteStream(fileIn)).on('finish', () => {
        compressor.minify({
          compressor: 'sqwish',
          input: fileIn,
          output: fileOut,
          callback: (err, min) => {
            if (err) {
              return reject(err)
            }

            fs.unlinkSync(fileIn)
            stream = fs.createReadStream(fileOut)

            stream.on('open', function() {
              return resolve(stream)
            })

            stream.on('close', function() {
              fs.unlinkSync(fileOut)
            })
          }
        })
      })
    })
  })
}

module.exports = function(format, request, handlerData) {
  return new CSSHandler(format, request, handlerData)
}

module.exports.CSSHandler = CSSHandler
