const config = require('./../../../config')
const fs = require('fs')
var mkdirp = require('mkdirp')
const nodeUrl = require('url')
const path = require('path')

const Missing = require(path.join(__dirname, '/missing'))

const DiskStorage = function({assetType = 'assets', domain, url}) {
  const assetPath = config.get(`${assetType}.directory.path`, domain)

  if (url !== '') {
    this.url = nodeUrl.parse(url, true).pathname
  } else {
    this.url = '/'
  }

  this.domain = domain
  this.path = path.resolve(assetPath)
}

DiskStorage.prototype.getFullUrl = function() {
  return decodeURIComponent(path.join(this.path, this.url))
}

DiskStorage.prototype.getLastModified = function() {
  return this.lastModified
}

/**
 * Scans a directory for files and compares them to the config.defaultFiles array,
 * returning an array of file names that match the defaultFiles array.
 */
DiskStorage.prototype.getDefaultFile = function() {
  return new Promise((resolve, reject) => {
    const fullUrl = this.getFullUrl()

    fs.lstat(fullUrl, (err, stats) => {
      if (err) return resolve()

      if (stats.isDirectory()) {
        const defaultFiles = config.get('defaultFiles')

        fs.readdir(fullUrl, (err, files) => {
          if (err) return resolve()

          files = files.filter(file =>
            defaultFiles.includes(path.basename(file))
          )

          return resolve(files[0] || 'no-default-configured')
        })
      }
    })
  })
}

DiskStorage.prototype.get = function() {
  return new Promise((resolve, reject) => {
    let wait = Promise.resolve()

    // If we're looking at a directory (assumed because no extension),
    // attempt to get a configured default file from the directory
    const isDirectory = path.parse(this.getFullUrl()).ext === ''

    if (isDirectory) {
      wait = this.getDefaultFile()
    }

    return wait.then(file => {
      if (file) {
        // reset the url property so that this.getFullUrl() now loads the default file
        this.url = `/${file}`
      }

      // attempt to open
      const stream = fs.createReadStream(this.getFullUrl())

      stream.on('open', () => {
        // check file size
        const stats = fs.statSync(this.getFullUrl())
        const fileSize = parseInt(stats.size)

        this.lastModified = stats.mtime

        if (fileSize === 0) {
          const err = {
            statusCode: 404,
            message: 'File size is 0 bytes'
          }

          return reject(err)
        }

        return resolve(stream)
      })

      stream.on('error', () => {
        const err = {
          statusCode: 404,
          message: 'File not found: ' + this.getFullUrl()
        }

        return new Missing()
          .get({
            domain: this.domain,
            isDirectory
          })
          .then(stream => {
            this.notFound = true
            this.lastModified = new Date()

            return resolve(stream)
          })
          .catch(e => {
            return reject(err)
          })
      })
    })
  })
}

DiskStorage.prototype.put = function (stream, folderPath) {
  this.path = path.join(this.path, folderPath)

  return new Promise((resolve, reject) => {
    mkdirp(this.path, (err, made) => {
      if (err) {
        return reject(err)
      }

      var filePath = this.getFullUrl()

      fs.stat(filePath, (err, stats) => {
        if (err) {
          // file not found on disk, so ok to write it with no filename changes
        } else {
          // file exists, give it a new name
          var pathParts = path.parse(filePath)
          var newFileName = pathParts.name + '-' + Date.now().toString()
          filePath = path.join(this.path, newFileName + pathParts.ext)
        }

        var writeStream = fs.createWriteStream(filePath)
        stream.pipe(writeStream)

        var data = {
          message: 'File uploaded',
          path: filePath.replace(path.resolve(this.settings.directory.path), '')
        }

        return resolve(data)
      })
    })
  })
}

//module.exports = DiskStorage
module.exports = function (settings, url) {
  return new DiskStorage(settings, url)
}

module.exports.DiskStorage = DiskStorage
