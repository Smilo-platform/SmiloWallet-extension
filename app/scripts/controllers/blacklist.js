const ObservableStore = require('obs-store')
const extend = require('xtend')
const PhishingDetector = require('eth-phishing-detect/src/detector')
const log = require('loglevel')

// compute phishing lists
const PHISHING_DETECTION_CONFIG = require('eth-phishing-detect/src/config.json')
// every four minutes
const POLLING_INTERVAL = 4 * 60 * 1000

const LIST_URLS = [
  "https://api.infura.io/v2/blacklist",
  "https://raw.githubusercontent.com/Smilo-platform/SmiloWallet-extension/develop/app/phishing-config.json"
]

class BlacklistController {

  /**
   * Responsible for polling for and storing an up to date 'eth-phishing-detect' config.json file, while
   * exposing a method that can check whether a given url is a phishing attempt. The 'eth-phishing-detect'
   * config.json file contains a fuzzylist, whitelist and blacklist.
   *
   *
   * @typedef {Object} BlacklistController
   * @param {object} opts Overrides the defaults for the initial state of this.store
   * @property {object} store The the store of the current phishing config
   * @property {object} store.phishing Contains fuzzylist, whitelist and blacklist arrays. @see
   * {@link https://github.com/MetaMask/eth-phishing-detect/blob/master/src/config.json}
   * @property {object} _phishingDetector The PhishingDetector instantiated by passing store.phishing to
   * PhishingDetector.
   * @property {object} _phishingUpdateIntervalRef Id of the interval created to periodically update the blacklist
   *
   */
  constructor (opts = {}) {
    const initState = extend({
      phishing: PHISHING_DETECTION_CONFIG,
      whitelist: [],
    }, opts.initState)
    this.store = new ObservableStore(initState)
    // phishing detector
    this._phishingDetector = null
    this._setupPhishingDetector(initState.phishing)
    // polling references
    this._phishingUpdateIntervalRef = null
  }

  /**
   * Adds the given hostname to the runtime whitelist
   * @param {string} hostname the hostname to whitelist
   */
  whitelistDomain (hostname) {
    if (!hostname) {
      return
    }

    const { whitelist } = this.store.getState()
    this.store.updateState({
      whitelist: [...new Set([hostname, ...whitelist])],
    })
  }

  /**
   * Given a url, returns the result of checking if that url is in the store.phishing blacklist
   *
   * @param {string} hostname The hostname portion of a url; the one that will be checked against the white and
   * blacklists of store.phishing
   * @returns {boolean} Whether or not the passed hostname is on our phishing blacklist
   *
   */
  checkForPhishing (hostname) {
    if (!hostname) return false

    const { whitelist } = this.store.getState()
    if (whitelist.some((e) => e === hostname)) {
      return false
    }

    const { result } = this._phishingDetector.check(hostname)
    return result
  }

  /**
   * Queries the urls defined in LIST_URLS for an updated blacklist config. This is passed to this._phishingDetector
   * to update our phishing detector instance, and is updated in the store. The new phishing config is returned
   *
   *
   * @returns {Promise<object>} Promises the updated blacklist config for the phishingDetector
   *
   */
  async updatePhishingList () {
    let config = {
      tolerance: 0,
      fuzzylist: [],
      whitelist: [],
      blacklist: []
    }
    for(let url of LIST_URLS) {
      // make request
      let response
      try {
        response = await fetch(url)
      } catch (err) {
        log.error(new Error(`BlacklistController - failed to fetch blacklist for url '${ url }':\n${err.stack}`))
        continue
      }
      // parse response
      let rawResponse
      let phishing
      try {
        const rawResponse = await response.text()
        phishing = JSON.parse(rawResponse)
      } catch (err) {
        log.error(new Error(`BlacklistController - failed to parse blacklist for url '${ url }':\n${rawResponse}`))
        continue
      }

      // Merge with current working config
      
      // Use highest tolerence
      config.tolerance = Math.max(config.tolerance, phishing.tolerance)

      config.fuzzylist = config.fuzzylist.concat(phishing.fuzzylist)
      config.whitelist = config.whitelist.concat(phishing.whitelist)
      config.blacklist = config.blacklist.concat(phishing.blacklist)
    }

    console.log("Updated phishing list to", config)
    
    // update current blacklist
    this.store.updateState({ config })
    this._setupPhishingDetector(config)
    return config
  }

  /**
   * Initiates the updating of the local blacklist at a set interval. The update is done via this.updatePhishingList().
   * Also, this method store a reference to that interval at this._phishingUpdateIntervalRef
   *
   */
  scheduleUpdates () {
    if (this._phishingUpdateIntervalRef) return
    this.updatePhishingList()
    this._phishingUpdateIntervalRef = setInterval(() => {
      this.updatePhishingList()
    }, POLLING_INTERVAL)
  }

  /**
   * Sets this._phishingDetector to a new PhishingDetector instance.
   * @see {@link https://github.com/MetaMask/eth-phishing-detect}
   *
   * @private
   * @param {object} config A config object like that found at {@link https://github.com/MetaMask/eth-phishing-detect/blob/master/src/config.json}
   *
   */
  _setupPhishingDetector (config) {
    this._phishingDetector = new PhishingDetector(config)
  }
}

module.exports = BlacklistController
