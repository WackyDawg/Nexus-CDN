const PassThrough = require('stream').PassThrough
const path = require('path')
const sha1 = require('sha1')

const config = require(path.join(__dirname, '/../../../config'))

const DadiCache = require('@dadi/cache')
const cache = new DadiCache(config.get('caching'))

/**
 * Creates a new Cache instance for the server
 * @constructor
 */
const Cache = function() {}

/**
 * Adds a stream to the cache
 * @param  {Stream}  stream   The stream to be cached
 * @param  {String}  key      The cache key
 * @param  {Object}  options  Optional options object
 * @param  {Boolean} wait     Whether to wait for the write operation
 * @return {Promise}
 */
Cache.prototype.cacheFile = function(stream, key, options, wait) {
  if (!this.isEnabled()) return Promise.resolve(stream)

  const encryptedKey = this.getNormalisedKey(key)
  const cacheStream = PassThrough()
  const responseStream = PassThrough()

  stream.pipe(cacheStream)
  stream.pipe(responseStream)

  const write = cache.set(encryptedKey, cacheStream, options)

  if (wait) {
    return write.then(() => responseStream)
  }

  return responseStream
}

/**
 * Deletes an item from cache.
 *
 * @param  {String}   pattern
 * @param  {Function} callback
 */
Cache.prototype.delete = function(pattern, callback = () => {}) {
  const hashedPattern = this.getNormalisedKey(pattern)

  cache
    .flush(hashedPattern)
    .then(() => {
      return callback(null)
    })
    .catch(err => {
      console.log(err)

      return callback(null)
    })
}

/**
 * Returns a normalised key. If the input is an array,
 * each element will be hashed individually and concatenated,
 * in order, to form the final string. Otherwise, the hash
 * of the string version of the input will be returned.
 *
 * @param  {Array/String} key
 * @return {String}
 */
Cache.prototype.getNormalisedKey = function(key) {
  if (key === '') return key

  if (Array.isArray(key)) {
    return key.reduce((normalisedKey, node) => {
      if (node || node === 0) {
        normalisedKey += sha1(node.toString())
      }

      return normalisedKey
    }, '')
  }

  return sha1(key.toString())
}

/**
 * Gets a stream for the given cache key, if it exists.
 *
 * Will return a Promise that is resolved with the Stream
 * if the cache key exists, or resolved with null otherwise.
 *
 * @param  {String} key     The cache key
 * @param  {Object} options Optional options object
 * @return {Promise}
 */
Cache.prototype.getStream = function(key, options) {
  if (!this.isEnabled()) return Promise.resolve(null)

  const encryptedKey = this.getNormalisedKey(key)

  return cache.get(encryptedKey, options).catch(err => {
    // eslint-disable-line handle-callback-err
    return null
  })
}

/**
 * Gets metadata associated with the given cache key, if it exists.
 *
 * Will return a Promise that is resolved with the metadata
 * if the cache key exists, or resolved with null otherwise.
 *
 * @param  {String} key The cache key
 * @return {Promise}
 */
Cache.prototype.getMetadata = function(key) {
  const encryptedKey = this.getNormalisedKey(key)

  return cache.getMetadata(encryptedKey)
}

/**
 * Checks whether caching is enabled.
 *
 * @return {Boolean}
 */
Cache.prototype.isEnabled = function() {
  return (
    config.get('caching.directory.enabled') ||
    config.get('caching.redis.enabled')
  )
}

/**
 * Saves an item to cache.
 *
 * @param {String} key   cache key
 * @param {[type]} value
 */
Cache.prototype.set = function(key, value, options) {
  if (!this.isEnabled()) return Promise.resolve(null)

  const encryptedKey = this.getNormalisedKey(key)

  return cache.set(encryptedKey, value, options)
}

let instance

module.exports = () => instance || new Cache()

module.exports.Cache = Cache

// Reset method (for unit tests).
module.exports.reset = function() {
  instance = null
}
