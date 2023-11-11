const cloudfront = require('cloudfront')
const compressible = require('compressible')
var concat = require('concat-stream')
const etag = require('etag')
const fs = require('fs')
const mime = require('mime')
const path = require('path')
const seek = require('./seek')
const sha1 = require('sha1')
const urlParser = require('url')
const zlib = require('zlib')
var _ = require('underscore')


const config = require(path.join(__dirname, '/../../../config'))
const DomainController = require(path.join(__dirname, '/domain'))
const help = require(path.join(__dirname, '/../help'))
const logger = require('@dadi/logger')
const PostController = require(path.join(__dirname, '/post'))
const HandlerFactory = require(path.join(__dirname, '/../handlers/factory'))
const RecipeController = require(path.join(__dirname, '/recipe'))
const RouteController = require(path.join(__dirname, '/route'))
const WorkQueue = require('./../workQueue')
const workspace = require(path.join(__dirname, '/../models/workspace'))

logger.init(config.get('logging'), config.get('logging.aws'), config.get('env'))

const workQueue = new WorkQueue()

const Controller = function (router) {
  router.use(logger.requestLogger)

  router.use(seek)

  router.get('/', function (req, res, next) {
    const filePath = path.join(__dirname, '../../../', 'public', 'index.xml'); // Relative path to the index.xml file

    fs.readFile(filePath, (err, data) => {
      if (err) {
        throw err;
      } else {
        console.log("Operation Success");
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end(data);
      }
    });
  });

  router.get('/robots.txt', (req, res) => {
    const robotsFile = config.get('robots')

    try {
      const file = fs.readFileSync(robotsFile)

      res.statusCode = 200
      res.end(file.toString())
    } catch (err) {
      res.statusCode = 404

      return res.end('File not found')
    }
  })

  router.get(/(.+)/, (req, res) => {
    const factory = new HandlerFactory(workspace.get())
    const queueKey = sha1(req.__domain + req.url)

    return workQueue
      .run(queueKey, () => {
        return factory.create(req).then(handler => {
          return handler
            .get()
            .then(data => {
              return { handler, data }
            })
            .catch(err => {
              err.__handler = handler

              return Promise.reject(err)
            })
        })
      })
      .then(({ handler, data }) => {
        this.addContentTypeHeader(res, handler)
        this.addCacheControlHeader(res, handler, req.__domain)
        this.addLastModifiedHeader(res, handler)
        this.addVaryHeader(res, handler)

        if (handler.storageHandler && handler.storageHandler.notFound) {
          res.statusCode =
            config.get('notFound.statusCode', req.__domain) || 404
        }

        if (handler.storageHandler && handler.storageHandler.cleanUp) {
          handler.storageHandler.cleanUp()
        }

        const etagResult = etag(data)

        res.setHeader('ETag', etagResult)

        if (this.shouldCompress(req, handler)) {
          res.setHeader('Content-Encoding', 'gzip')

          data = new Promise((resolve, reject) => {
            zlib.gzip(data, (err, compressedData) => {
              if (err) return reject(err)

              res.setHeader('Content-Length', compressedData.byteLength)
              resolve(compressedData)
            })
          })
        } else {
          res.setHeader(
            'Content-Length',
            Buffer.isBuffer(data) ? data.byteLength : data.length
          )
        }

        return Promise.resolve(data).then(data => {
          if (req.headers.range) {
            res.sendSeekable(data)
          } else if (
            req.headers['if-none-match'] === etagResult &&
            handler.getContentType() !== 'application/json'
          ) {
            res.statusCode = 304
            res.end()
          } else {
            const cacheHeader =
              (handler.getHeader && handler.getHeader('x-cache')) ||
              (handler.isCached ? 'HIT' : 'MISS')

            res.setHeader('X-Cache', cacheHeader)
            res.end(data)
          }
        })
      })
      .catch(err => {
        logger.error({ err })

        if (err.__handler) {
          res.setHeader('X-Cache', err.__handler.isCached ? 'HIT' : 'MISS')

          delete err.__handler
        }

        help.sendBackJSON(err.statusCode || 400, err, res)
      })
  })

  // Invalidation request
  router.post('/api/flush', function (req, res) {
    if (!req.body.pattern) {
      return help.sendBackJSON(
        400,
        {
          success: false,
          message: "A 'pattern' must be specified"
        },
        res
      )
    }

    let pattern = [req.__domain]

    if (req.body.pattern !== '*') {
      const parsedUrl = urlParser.parse(req.body.pattern, true)

      pattern = pattern.concat([
        parsedUrl.pathname,
        parsedUrl.search ? parsedUrl.search.slice(1) : null
      ])
    }

    help.clearCache(pattern, err => {
      if (err) console.log(err)

      if (!config.get('cloudfront.enabled')) {
        return help.sendBackJSON(
          200,
          {
            success: true,
            message: `Cache flushed for pattern "${req.body.pattern}"`
          },
          res
        )
      }

      // Invalidate the Cloudfront cache
      const cf = cloudfront.createClient(
        config.get('cloudfront.accessKey'),
        config.get('cloudfront.secretKey')
      )

      cf.getDistribution(config.get('cloudfront.distribution'), function (
        err,
        distribution
      ) {
        if (err) console.log(err)

        const callerReference = new Date().toString()

        distribution.invalidate(
          callerReference,
          ['/' + req.body.pattern],
          function (err, invalidation) {
            if (err) console.log(err)

            return help.sendBackJSON(
              200,
              {
                success: true,
                message:
                  'Cache and cloudfront flushed for pattern ' + req.body.pattern
              },
              res
            )
          }
        )
      })
    })
  })

  router.post('/api/recipes', function (req, res) {
    return RecipeController.post(req, res)
  })

  router.post('/api/routes', function (req, res) {
    return RouteController.post(req, res)
  })

  router.post('/api/upload', function (req, res, next) {
    if (!config.get('upload.enabled')) {
      return next()
    }

    return new PostController().post(req, res)
  })

  router.use('/_dadi/domains/:domain?', function (req, res, next) {
    if (
      !config.get('dadiNetwork.enableConfigurationAPI') ||
      !config.get('multiDomain.enabled')
    ) {
      return next()
    }

    return DomainController[req.method.toLowerCase()](req, res)
  })
}

/**
 * Determines whether the response should be compressed
 *
 * @param {Object} req - the original HTTP request, containing headers
 * @param {Object} handler - the current asset handler (image, CSS, JS)
 * @returns {Boolean} - whether to compress the data before sending the response
 */
Controller.prototype.shouldCompress = function (req, handler) {
  const acceptHeader = req.headers['accept-encoding'] || ''
  const contentType = handler.getContentType()
  const useCompression = config.get('headers.useGzipCompression', req.__domain)

  return (
    useCompression &&
    contentType !== 'application/json' &&
    acceptHeader.split(',').includes('gzip') &&
    compressible(contentType)
  )
}

Controller.prototype.addContentTypeHeader = function (res, handler) {
  if (handler.getContentType()) {
    res.setHeader('Content-Type', handler.getContentType())
  }
}

Controller.prototype.addLastModifiedHeader = function (res, handler) {
  if (!handler) return

  if (handler.getLastModified) {
    const lastMod = handler.getLastModified()

    if (lastMod) res.setHeader('Last-Modified', lastMod)
  }
}

Controller.prototype.addVaryHeader = function (res, handler) {
  if (!handler) return

  res.setHeader('Vary', 'Accept-Encoding')
}

Controller.prototype.addCacheControlHeader = function (res, handler, domain) {
  const configHeaderSets = config.get('headers.cacheControl', domain)

  // If it matches, sets Cache-Control header using the file path
  configHeaderSets.paths.forEach(obj => {
    const key = Object.keys(obj)[0]
    const value = obj[key]

    if (handler.storageHandler.getFullUrl().indexOf(key) > -1) {
      setHeader(value)
    }
  })

  // If not already set, sets Cache-Control header using the file mimetype
  configHeaderSets.mimetypes.forEach(obj => {
    const key = Object.keys(obj)[0]
    const value = obj[key]

    if (handler.getFilename && mime.getType(handler.getFilename()) === key) {
      setHeader(value)
    }
  })

  // If not already set, sets Cache-Control header using the default
  setHeader(configHeaderSets.default)

  function setHeader(value) {
    if (!value || value.length === 0) return

    // already set
    if (res.getHeader('cache-control')) return

    // set the header
    res.setHeader('Cache-Control', value)
  }
}

//module.exports = Controller
module.exports = function (model) {
  return new Controller(model)
}